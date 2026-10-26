import type { BannerTheme } from '@consentflow/shared';

export function buildCss(t: BannerTheme, custom: string): string {
  return `
:host{all:initial}
*{box-sizing:border-box}
.cf{--bg:${t.background};--fg:${t.text};--pri:${t.primary};--pri-fg:${t.primaryText};--sec:${t.secondary};--sec-fg:${t.secondaryText};--r:${t.radius}px;
  font-family:${t.fontFamily};font-size:14px;line-height:1.5;color:var(--fg)}
.cf button{font:inherit;cursor:pointer}
.cf a{color:inherit}
.cf :focus-visible{outline:2px solid var(--pri);outline-offset:2px}
.banner{position:fixed;z-index:2147483646;background:var(--bg);color:var(--fg);box-shadow:0 8px 32px rgba(15,23,42,.22);padding:20px;display:flex;flex-direction:column;gap:14px;max-height:calc(100vh - 32px);overflow:auto}
.banner h2{margin:0;font-size:17px;line-height:1.3;font-weight:650}
.banner p{margin:0}
.layout-bar{left:0;right:0;border-radius:0;flex-direction:row;align-items:center;flex-wrap:wrap;padding:16px max(20px,env(safe-area-inset-right))}
.layout-bar .text{flex:1 1 420px;min-width:0}
.layout-bar.pos-top{top:0}
.layout-bar:not(.pos-top){bottom:0}
.layout-box{width:min(420px,calc(100vw - 32px));border-radius:var(--r)}
.layout-box.pos-bottom-left,.layout-box.pos-bottom{left:16px;bottom:16px}
.layout-box.pos-bottom-right{right:16px;bottom:16px}
.layout-box.pos-top{left:16px;top:16px}
.layout-box.pos-center,.layout-popup{left:50%;top:50%;transform:translate(-50%,-50%);bottom:auto}
.layout-popup{width:min(560px,calc(100vw - 32px));border-radius:var(--r)}
.backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2147483645}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.layout-bar .actions{flex:0 0 auto}
.btn{border:1px solid transparent;border-radius:calc(var(--r) * .7);padding:10px 16px;font-weight:600;flex:1 1 auto;white-space:nowrap}
.btn-pri{background:var(--pri);color:var(--pri-fg)}
.btn-sec{background:var(--sec);color:var(--sec-fg)}
.btn-link{background:none;border:0;padding:0;text-decoration:underline;font-weight:500;color:inherit}
.links{font-size:13px;display:flex;gap:14px;flex-wrap:wrap}
.modal{position:fixed;z-index:2147483647;left:50%;top:50%;transform:translate(-50%,-50%);width:min(620px,calc(100vw - 24px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;background:var(--bg);border-radius:var(--r);box-shadow:0 16px 48px rgba(15,23,42,.3)}
.modal header{padding:20px 22px 8px;display:flex;align-items:flex-start;gap:12px}
.modal header h2{margin:0;font-size:19px;flex:1}
.modal .body{padding:6px 22px 12px;overflow:auto}
.modal footer{padding:14px 22px 20px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid rgba(127,127,127,.2)}
.close{background:none;border:0;font-size:22px;line-height:1;padding:4px 8px;color:inherit;border-radius:6px}
.cat{border:1px solid rgba(127,127,127,.25);border-radius:calc(var(--r) * .8);margin:10px 0;padding:12px 14px}
.cat-h{display:flex;align-items:center;gap:12px}
.cat-h b{flex:1;font-size:15px}
.cat p{margin:6px 0 0;font-size:13px;opacity:.85}
.always{font-size:12px;font-weight:600;opacity:.75}
.switch{position:relative;width:42px;height:24px;flex:none}
.switch input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer;z-index:1}
.switch span{position:absolute;inset:0;border-radius:12px;background:rgba(127,127,127,.4);transition:background .15s}
.switch span::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}
.switch input:checked+span{background:var(--pri)}
.switch input:checked+span::after{transform:translateX(18px)}
.switch input:focus-visible+span{outline:2px solid var(--pri);outline-offset:2px}
details{margin-top:8px;font-size:12.5px}
summary{cursor:pointer;opacity:.85}
table{width:100%;border-collapse:collapse;margin-top:6px}
th,td{text-align:left;padding:5px 6px;border-bottom:1px solid rgba(127,127,127,.18);vertical-align:top}
th{font-weight:600}
.fab{position:fixed;left:16px;bottom:16px;z-index:2147483640;width:44px;height:44px;border-radius:50%;border:0;background:var(--pri);color:var(--pri-fg);display:grid;place-items:center;box-shadow:0 4px 16px rgba(15,23,42,.25)}
.fab svg{width:22px;height:22px}
@media (max-width:520px){.layout-box,.layout-popup{left:8px!important;right:8px;bottom:8px!important;top:auto!important;transform:none!important;width:auto}.actions .btn{flex-basis:100%}}
@media (prefers-reduced-motion:reduce){.switch span,.switch span::after{transition:none}}
${custom || ''}`;
}

export const PLACEHOLDER_CSS =
  'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:20px;background:#f1f3f7;color:#1d2433;border:1px dashed #aab2c0;border-radius:8px;font:14px/1.5 system-ui,sans-serif;box-sizing:border-box;max-width:100%;';
