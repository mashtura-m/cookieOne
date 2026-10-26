import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from '@consentflow/shared';
import { audit, requireAuth, requireDomain } from '../auth';
import { one, q, tx } from '../db';
import { badRequest } from '../errors';
import { bundleForDomainId, buildPublicConfig, invalidateDomainCache, loadRules, type BannerRow } from '../lib/public-config';

const Hex = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'Use a hex color like #1f5eff');
const TextFields = z.record(z.string(), z.unknown());

const BannerInput = z.object({
  layout: z.enum(['bar', 'box', 'popup']),
  position: z.enum(['bottom', 'top', 'bottom-left', 'bottom-right', 'center']),
  theme: z.object({
    background: Hex, text: Hex, primary: Hex, primaryText: Hex, secondary: Hex, secondaryText: Hex,
    radius: z.number().min(0).max(32), fontFamily: z.string().max(200),
  }),
  texts: z.record(z.string().min(2).max(5), TextFields),
  languages: z.array(z.string().min(2).max(5)).min(1).max(40),
  defaultLanguage: z.string().min(2).max(5),
  showRejectAll: z.boolean(),
  showFloatingButton: z.boolean(),
  customCss: z.string().max(20000),
});

const GeoRuleInput = z.object({
  name: z.string().trim().min(1).max(100),
  regulation: z.enum(['gdpr', 'ccpa', 'lgpd', 'none']),
  model: z.enum(['opt_in', 'opt_out', 'notice']),
  regions: z.array(z.string().trim().regex(/^(\*|[A-Za-z]{2}(-[A-Za-z0-9]{1,3})?)$/, 'Use ISO codes like DE, US-CA or *')).min(1),
  honorGpc: z.boolean(),
  priority: z.number().int().min(0).max(1000),
  enabled: z.boolean(),
});

function toApi(b: BannerRow) {
  return {
    id: b.id, version: b.version, status: b.status, layout: b.layout, position: b.position, theme: b.theme, texts: b.texts,
    languages: b.languages, defaultLanguage: b.default_language, showRejectAll: b.show_reject_all, showFloatingButton: b.show_floating_button,
    customCss: b.custom_css, createdAt: b.created_at, publishedAt: b.published_at,
  };
}

/** The draft is created lazily as a copy of the published config. */
async function getOrCreateDraft(domainId: string, userId: string): Promise<BannerRow> {
  const draft = await one<BannerRow>(`SELECT * FROM banner_configs WHERE domain_id=$1 AND status='draft'`, [domainId]);
  if (draft) return draft;
  return (await one<BannerRow>(
    `INSERT INTO banner_configs (domain_id, version, status, layout, position, theme, texts, languages, default_language, show_reject_all, show_floating_button, custom_css, created_by)
     SELECT domain_id, (SELECT COALESCE(max(version),0)+1 FROM banner_configs WHERE domain_id=$1), 'draft', layout, position, theme, texts, languages, default_language, show_reject_all, show_floating_button, custom_css, $2
     FROM banner_configs WHERE domain_id=$1 ORDER BY version DESC LIMIT 1
     RETURNING *`,
    [domainId, userId],
  ))!;
}

export async function bannerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { id: string } }>('/api/domains/:id/banner', async (req) => {
    const d = await requireDomain(req, req.params.id);
    const published = await one<BannerRow>(`SELECT * FROM banner_configs WHERE domain_id=$1 AND status='published'`, [d.id]);
    const draft = d.role === 'viewer'
      ? await one<BannerRow>(`SELECT * FROM banner_configs WHERE domain_id=$1 AND status='draft'`, [d.id])
      : await getOrCreateDraft(d.id, req.user.id);
    return { draft: draft ? toApi(draft) : null, published: published ? toApi(published) : null, supportedLanguages: SUPPORTED_LANGUAGES };
  });

  app.put<{ Params: { id: string } }>('/api/domains/:id/banner', async (req) => {
    const d = await requireDomain(req, req.params.id, 'editor');
    const b = BannerInput.parse(req.body);
    if (!b.languages.includes(b.defaultLanguage)) throw badRequest('The default language must be one of the selected languages');
    const draft = await getOrCreateDraft(d.id, req.user.id);
    const row = await one<BannerRow>(
      `UPDATE banner_configs SET layout=$2, position=$3, theme=$4, texts=$5, languages=$6, default_language=$7, show_reject_all=$8, show_floating_button=$9, custom_css=$10
       WHERE id=$1 RETURNING *`,
      [draft.id, b.layout, b.position, b.theme, b.texts, b.languages, b.defaultLanguage, b.showRejectAll, b.showFloatingButton, b.customCss],
    );
    return toApi(row!);
  });

  app.post<{ Params: { id: string } }>('/api/domains/:id/banner/publish', async (req) => {
    const d = await requireDomain(req, req.params.id, 'editor');
    const draft = await one<BannerRow>(`SELECT * FROM banner_configs WHERE domain_id=$1 AND status='draft'`, [d.id]);
    if (!draft) throw badRequest('There are no unpublished changes');
    const row = await tx(async (c) => {
      await c.query(`UPDATE banner_configs SET status='archived' WHERE domain_id=$1 AND status='published'`, [d.id]);
      return (await c.query<BannerRow>(`UPDATE banner_configs SET status='published', published_at=now() WHERE id=$1 RETURNING *`, [draft.id])).rows[0];
    });
    invalidateDomainCache(d.public_key);
    await audit(d.org_id, req.user.id, 'banner.published', { version: row.version }, d.id);
    return toApi(row);
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id/banner/versions', async (req) => {
    const d = await requireDomain(req, req.params.id);
    const rows = await q<BannerRow & { created_by_name: string | null }>(
      `SELECT b.*, u.name AS created_by_name FROM banner_configs b LEFT JOIN users u ON u.id=b.created_by WHERE b.domain_id=$1 ORDER BY b.version DESC`,
      [d.id],
    );
    return rows.map((r) => ({ ...toApi(r), createdByName: r.created_by_name }));
  });

  /** A full PublicConfig built from the draft, for the live preview iframe in the banner builder. */
  app.get<{ Params: { id: string }; Querystring: { country?: string; region?: string; draft?: string } }>('/api/domains/:id/banner/preview-config', async (req) => {
    const d = await requireDomain(req, req.params.id);
    const status = req.query.draft === 'false' ? 'published' : 'draft';
    const banner = (await one<BannerRow>(`SELECT * FROM banner_configs WHERE domain_id=$1 AND status=$2`, [d.id, status]))
      ?? (await one<BannerRow>(`SELECT * FROM banner_configs WHERE domain_id=$1 AND status='published'`, [d.id]));
    const bundle = await bundleForDomainId(d.id, banner!);
    return buildPublicConfig(bundle, { country: req.query.country?.toUpperCase() ?? 'DE', region: req.query.region?.toUpperCase() ?? null }, true);
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id/geo-rules', async (req) => {
    const d = await requireDomain(req, req.params.id);
    return loadRules(d.id);
  });

  app.put<{ Params: { id: string } }>('/api/domains/:id/geo-rules', async (req) => {
    const d = await requireDomain(req, req.params.id, 'editor');
    const rules = z.array(GeoRuleInput).max(50).parse(req.body);
    await tx(async (c) => {
      await c.query('DELETE FROM geo_rules WHERE domain_id=$1', [d.id]);
      for (const r of rules) {
        await c.query(
          'INSERT INTO geo_rules (domain_id, name, regulation, model, regions, honor_gpc, priority, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [d.id, r.name, r.regulation, r.model, r.regions.map((x) => x.toUpperCase()), r.honorGpc, r.priority, r.enabled],
        );
      }
    });
    invalidateDomainCache(d.public_key);
    await audit(d.org_id, req.user.id, 'geo_rules.updated', { count: rules.length }, d.id);
    return loadRules(d.id);
  });
}
