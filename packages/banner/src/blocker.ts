import type { Category } from '@consentflow/shared';

export const BLOCKED_TYPE = 'javascript/blocked';

type Allowed = (c: Category) => boolean;

interface BlockedItem {
  el: HTMLScriptElement | HTMLIFrameElement;
  category: Category;
  placeholder?: HTMLElement;
}

export interface PlaceholderFactory {
  (iframe: HTMLIFrameElement, category: Category): HTMLElement | null;
}

const CATS: Category[] = ['necessary', 'preferences', 'statistics', 'marketing'];
const asCategory = (v: string | null): Category | null => (v && (CATS as string[]).includes(v) ? (v as Category) : null);

/**
 * Blocks third-party scripts and iframes until their category is allowed.
 *
 * Two mechanisms:
 *  - manual: the site marks tags itself, e.g. <script type="text/plain" data-category="statistics">
 *    or <iframe data-cf-src="..." data-category="marketing">. These never run until released.
 *  - automatic: tags whose URL matches a known tracker pattern are neutralised as they are inserted
 *    (MutationObserver for parser-inserted tags, a createElement patch for script-inserted tags).
 */
export class Blocker {
  private blocked: BlockedItem[] = [];
  private observer: MutationObserver | null = null;
  private origCreate: typeof document.createElement | null = null;

  constructor(
    private rules: { pattern: string; category: Category }[],
    private allowed: Allowed,
    private placeholder: PlaceholderFactory = () => null,
  ) {}

  categoryFor(url: string | null | undefined): Category | null {
    if (!url) return null;
    let best: { pattern: string; category: Category } | null = null;
    for (const r of this.rules) {
      if (url.includes(r.pattern) && (!best || r.pattern.length > best.pattern.length)) best = r;
    }
    return best ? best.category : null;
  }

  /** Start automatic blocking. Must run before any tracker tag is parsed. */
  installAuto(): void {
    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => this.inspect(n));
      }
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
    this.patchCreateElement();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.origCreate) document.createElement = this.origCreate;
    this.origCreate = null;
  }

  /** Register manually marked tags already in the page. */
  collectManual(root: ParentNode = document): void {
    root.querySelectorAll('script[type="text/plain"][data-category], iframe[data-cf-src]').forEach((n) => this.inspect(n));
  }

  private inspect(node: Node): void {
    if (!(node instanceof Element)) return;
    if (node.tagName === 'SCRIPT') this.inspectScript(node as HTMLScriptElement);
    else if (node.tagName === 'IFRAME') this.inspectIframe(node as HTMLIFrameElement);
    else if (node.querySelectorAll) node.querySelectorAll('script, iframe').forEach((n) => this.inspect(n));
  }

  private isTracked(el: Element): boolean {
    return this.blocked.some((b) => b.el === el) || el.hasAttribute('data-cf-released');
  }

  private inspectScript(s: HTMLScriptElement): void {
    if (this.isTracked(s) || s.hasAttribute('data-cf-ignore')) return;
    const manual = asCategory(s.getAttribute('data-category'));
    if (s.type === 'text/plain' && manual) {
      this.blocked.push({ el: s, category: manual });
      return;
    }
    const cat = manual ?? this.categoryFor(s.src || s.getAttribute('src'));
    if (!cat || this.allowed(cat)) return;
    if (s.type && s.type !== BLOCKED_TYPE) s.setAttribute('data-cf-type', s.type);
    s.type = BLOCKED_TYPE;
    // Firefox fires this for parser-inserted scripts; cancelling it prevents execution.
    s.addEventListener('beforescriptexecute', function block(e) {
      if (s.getAttribute('type') === BLOCKED_TYPE) e.preventDefault();
      s.removeEventListener('beforescriptexecute', block);
    });
    this.blocked.push({ el: s, category: cat });
  }

  private inspectIframe(f: HTMLIFrameElement): void {
    if (this.isTracked(f)) return;
    const manualSrc = f.getAttribute('data-cf-src');
    const cat = asCategory(f.getAttribute('data-category')) ?? this.categoryFor(manualSrc || f.src);
    if (!cat) return;
    if (this.allowed(cat)) {
      if (manualSrc) this.releaseIframe({ el: f, category: cat });
      return;
    }
    if (!manualSrc && f.src) {
      f.setAttribute('data-cf-src', f.src);
      f.removeAttribute('src');
    }
    const item: BlockedItem = { el: f, category: cat };
    const ph = this.placeholder(f, cat);
    if (ph && f.parentNode) {
      f.parentNode.insertBefore(ph, f);
      f.style.setProperty('display', 'none', 'important');
      item.placeholder = ph;
    }
    this.blocked.push(item);
  }

  private patchCreateElement(): void {
    const self = this;
    const orig = document.createElement;
    this.origCreate = orig;
    const srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
    const typeDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'type');
    if (!srcDesc?.set || !typeDesc?.set) return;
    document.createElement = function (this: Document, tag: string, opts?: ElementCreationOptions) {
      const el = orig.call(this, tag, opts);
      if (String(tag).toLowerCase() !== 'script') return el;
      const script = el as HTMLScriptElement;
      Object.defineProperty(script, 'src', {
        configurable: true,
        get() {
          return srcDesc.get!.call(this);
        },
        set(value: string) {
          const cat = self.categoryFor(String(value));
          if (cat && !self.allowed(cat)) {
            typeDesc.set!.call(this, BLOCKED_TYPE);
            self.blocked.push({ el: script, category: cat });
          }
          srcDesc.set!.call(this, value);
        },
      });
      Object.defineProperty(script, 'type', {
        configurable: true,
        get() {
          return typeDesc.get!.call(this);
        },
        set(value: string) {
          // Do not let the page undo our block by setting type="text/javascript" afterwards.
          if (typeDesc.get!.call(this) === BLOCKED_TYPE && self.blocked.some((b) => b.el === script)) {
            script.setAttribute('data-cf-type', value);
            return;
          }
          typeDesc.set!.call(this, value);
        },
      });
      const origSetAttr = script.setAttribute.bind(script);
      script.setAttribute = (name: string, value: string) => {
        if (name.toLowerCase() === 'src') (script as HTMLScriptElement).src = value;
        else if (name.toLowerCase() === 'type') (script as HTMLScriptElement).type = value;
        else origSetAttr(name, value);
      };
      return el;
    } as typeof document.createElement;
  }

  /** Run everything whose category is now allowed. Returns how many tags were released. */
  release(): number {
    let n = 0;
    const keep: BlockedItem[] = [];
    for (const item of this.blocked) {
      if (!this.allowed(item.category)) {
        keep.push(item);
        continue;
      }
      if (item.el.tagName === 'SCRIPT') this.releaseScript(item.el as HTMLScriptElement);
      else this.releaseIframe(item);
      n++;
    }
    this.blocked = keep;
    return n;
  }

  pending(): { category: Category; tag: string; src: string }[] {
    return this.blocked.map((b) => ({
      category: b.category,
      tag: b.el.tagName.toLowerCase(),
      src: b.el.getAttribute('data-cf-src') || (b.el as HTMLScriptElement).src || '',
    }));
  }

  private releaseScript(old: HTMLScriptElement): void {
    const create = this.origCreate ?? document.createElement;
    const fresh = create.call(document, 'script') as HTMLScriptElement;
    for (const attr of Array.from(old.attributes)) {
      if (['type', 'data-cf-type', 'src'].includes(attr.name)) continue;
      fresh.setAttribute(attr.name, attr.value);
    }
    fresh.setAttribute('data-cf-released', '');
    const type = old.getAttribute('data-cf-type') || old.getAttribute('data-type');
    if (type && type !== 'text/plain') fresh.type = type;
    const src = old.getAttribute('src') || old.getAttribute('data-src');
    if (src) fresh.src = src;
    else fresh.text = old.text;
    old.parentNode ? old.parentNode.replaceChild(fresh, old) : document.head.appendChild(fresh);
  }

  private releaseIframe(item: BlockedItem): void {
    const f = item.el as HTMLIFrameElement;
    const src = f.getAttribute('data-cf-src');
    f.setAttribute('data-cf-released', '');
    if (src) f.src = src;
    f.style.removeProperty('display');
    item.placeholder?.remove();
  }
}
