// Towber admin console: web page at /admin plus the /api/admin/* routes it uses.
// Everything here runs with the service role and is gated by public.admin_users.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'admin', 'index.html');
const DOC_BUCKET = 'partner-documents-private';
const SERVICES = ['jumpstart', 'lockout', 'fuel', 'tyre', 'repair'];

const fail = (status, message) => Object.assign(new Error(message), { statusCode: status, publicMessage: message });
const uuid = z.string().uuid();
const money = z.number().min(0).max(100000);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

export function registerAdmin(app, supabase) {
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const body = (schema, req) => {
    const r = schema.safeParse(req.body ?? {});
    if (!r.success) throw fail(400, r.error.issues[0]?.message ? `Check your input: ${r.error.issues[0].path.join('.') || 'value'} ${r.error.issues[0].message}` : 'Check your input.');
    return r.data;
  };
  const idParam = (req) => {
    const r = uuid.safeParse(req.params.id);
    if (!r.success) throw fail(400, 'Invalid id.');
    return r.data;
  };
  // Turns the readable errors raised by the admin_* SQL functions into proper HTTP errors.
  const dbFail = (error) => {
    const m = error?.message ?? '';
    if (m.includes('conflict:')) throw fail(409, 'This was already reviewed, or is no longer waiting for review.');
    if (m.includes('not_found') || error?.code === 'P0002') throw fail(404, 'Not found.');
    if (error?.code === '22023') throw fail(400, m);
    throw error;
  };
  const must = ({ data, error }) => { if (error) dbFail(error); return data; };

  // A fresh client per sign-in, so one admin's session never leaks into the shared service client.
  const authClient = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const isAdmin = async (userId) => {
    const { data } = await supabase.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle();
    return !!data;
  };

  async function requireAdmin(req, res, next) {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
    if (!token) return res.status(401).json({ error: 'Please sign in.' });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
    if (!(await isAdmin(data.user.id))) return res.status(403).json({ error: 'This account is not an administrator.' });
    req.admin = { id: data.user.id, email: data.user.email ?? '' };
    next();
  }
  const audit = async (req, action, entity, entityId, details = {}) => {
    const { error } = await supabase.from('admin_audit_log').insert({
      admin_user_id: req.admin.id, admin_email: req.admin.email, action, entity,
      entity_id: entityId == null ? null : String(entityId), details,
    });
    if (error) console.warn('admin audit write failed:', error.message);
  };

  // ---- Page ----
  app.get('/admin', (_req, res) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'", "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com',
        "img-src 'self' data: https://*.supabase.co", "connect-src 'self'",
        "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
      ].join('; '),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    res.sendFile(PAGE);
  });

  // ---- Sign in (email + password of an account listed in admin_users) ----
  const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } });
  const refreshLimit = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
  const sessionOut = (s) => ({ accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: s.expires_at, email: s.user?.email ?? '' });

  app.post('/api/admin/login', loginLimit, wrap(async (req, res) => {
    const b = body(z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) }), req);
    const { data, error } = await authClient().auth.signInWithPassword(b);
    if (error || !data.session) return res.status(401).json({ error: 'Incorrect email or password.' });
    if (!(await isAdmin(data.user.id))) return res.status(403).json({ error: 'This account is not an administrator.' });
    res.json(sessionOut(data.session));
  }));

  app.post('/api/admin/refresh', refreshLimit, wrap(async (req, res) => {
    const b = body(z.object({ refreshToken: z.string().min(10).max(500) }), req);
    const { data, error } = await authClient().auth.refreshSession({ refresh_token: b.refreshToken });
    if (error || !data.session) return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
    res.json(sessionOut(data.session));
  }));

  const A = requireAdmin;
  app.get('/api/admin/me', A, (req, res) => res.json({ id: req.admin.id, email: req.admin.email }));

  // ---- Overview ----
  app.get('/api/admin/stats', A, wrap(async (_req, res) => {
    res.json(must(await supabase.rpc('admin_dashboard_stats')));
  }));

  // ---- Partner applications ----
  app.get('/api/admin/applications', A, wrap(async (req, res) => {
    const filter = z.enum(['open', 'submitted', 'needs_info', 'approved', 'rejected', 'all']).catch('open').parse(req.query.status);
    let q = supabase.from('partner_applications')
      .select('id, user_id, partner_tier, capabilities, business_name, contact_phone, vehicle_registration, status, submitted_at, reviewed_at, review_notes, company_id')
      .neq('status', 'draft').limit(200);
    if (filter === 'open') q = q.in('status', ['submitted', 'needs_info']);
    else if (filter !== 'all') q = q.eq('status', filter);
    const rows = must(await q.order('submitted_at', { ascending: filter === 'open', nullsFirst: false })) ?? [];
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const ids = rows.map((r) => r.id);
    const [profiles, docs] = await Promise.all([
      userIds.length ? supabase.from('user_profiles').select('user_id, email, full_name').in('user_id', userIds) : { data: [] },
      ids.length ? supabase.from('partner_documents').select('application_id').in('application_id', ids) : { data: [] },
    ]);
    const profileBy = new Map((profiles.data ?? []).map((p) => [p.user_id, p]));
    const docCount = new Map();
    for (const d of docs.data ?? []) docCount.set(d.application_id, (docCount.get(d.application_id) ?? 0) + 1);
    res.json({
      applications: rows.map((r) => ({ ...r, email: profileBy.get(r.user_id)?.email ?? null, fullName: profileBy.get(r.user_id)?.full_name ?? null, documents: docCount.get(r.id) ?? 0 })),
    });
  }));

  app.get('/api/admin/applications/:id', A, wrap(async (req, res) => {
    const id = idParam(req);
    const application = must(await supabase.from('partner_applications').select('*').eq('id', id).maybeSingle());
    if (!application) throw fail(404, 'Application not found.');
    const [profile, docsRes, required] = await Promise.all([
      supabase.from('user_profiles').select('email, full_name, phone').eq('user_id', application.user_id).maybeSingle(),
      supabase.from('partner_documents').select('id, document_type, object_path, content_type, file_size_bytes, expires_on, review_status, rejection_reason, created_at').eq('application_id', id).order('created_at'),
      supabase.rpc('partner_required_documents', { p_application_id: id }),
    ]);
    const documents = must(docsRes) ?? [];
    const signed = documents.length ? await supabase.storage.from(DOC_BUCKET).createSignedUrls(documents.map((d) => d.object_path), 600) : { data: [] };
    const urlBy = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
    res.json({
      application,
      profile: profile.data ?? null,
      required: must(required) ?? [],
      documents: documents.map(({ object_path, ...d }) => ({ ...d, url: urlBy.get(object_path) ?? null })),
    });
  }));

  app.post('/api/admin/applications/:id/approve', A, wrap(async (req, res) => {
    const id = idParam(req);
    const b = body(z.object({ notes: z.string().trim().max(1000).optional() }), req);
    const companyId = must(await supabase.rpc('admin_approve_partner_application', {
      p_application_id: id, p_reviewer_user_id: req.admin.id, p_notes: b.notes || null,
    }));
    await audit(req, 'application.approve', 'partner_application', id, { companyId });
    res.json({ ok: true, companyId });
  }));

  app.post('/api/admin/applications/:id/decision', A, wrap(async (req, res) => {
    const id = idParam(req);
    const b = body(z.object({ decision: z.enum(['needs_info', 'rejected']), notes: z.string().trim().min(3, 'needs a note the applicant will see').max(1000) }), req);
    must(await supabase.rpc('admin_review_partner_application', {
      p_application_id: id, p_reviewer_user_id: req.admin.id, p_decision: b.decision, p_notes: b.notes,
    }));
    await audit(req, `application.${b.decision}`, 'partner_application', id, { notes: b.notes });
    res.json({ ok: true });
  }));

  app.post('/api/admin/documents/:id/review', A, wrap(async (req, res) => {
    const id = idParam(req);
    const b = body(z.object({ status: z.enum(['approved', 'rejected', 'pending']), reason: z.string().trim().max(300).optional() }), req);
    must(await supabase.from('partner_documents').update({ review_status: b.status, rejection_reason: b.status === 'rejected' ? (b.reason || null) : null }).eq('id', id));
    await audit(req, `document.${b.status}`, 'partner_document', id, { reason: b.reason ?? null });
    res.json({ ok: true });
  }));

  // ---- Partners ----
  app.get('/api/admin/partners', A, wrap(async (_req, res) => {
    res.json({ partners: must(await supabase.rpc('admin_partner_overview')) ?? [] });
  }));

  app.get('/api/admin/partners/:id', A, wrap(async (req, res) => {
    const id = idParam(req);
    const company = must(await supabase.from('towing_companies').select('id, company_name, registration_number, contact_phone, is_verified, created_at, owner_user_id').eq('id', id).maybeSingle());
    if (!company) throw fail(404, 'Partner not found.');
    const [vehicles, towRates, flatRates] = await Promise.all([
      supabase.from('vehicles').select('id, registration_number, vehicle_type, is_active, updated_at').eq('company_id', id).order('registration_number', { ascending: true }),
      supabase.from('tow_fare_rates').select('service_class_code, callout_fee_zar, per_km_rate_zar, minimum_fare_zar').eq('company_id', id).eq('active', true),
      supabase.from('service_flat_rates').select('service_code, flat_fee_zar').eq('company_id', id).eq('active', true),
    ]);
    res.json({ company, vehicles: vehicles.data ?? [], towRates: towRates.data ?? [], flatRates: flatRates.data ?? [] });
  }));

  app.post('/api/admin/partners/:id/verify', A, wrap(async (req, res) => {
    const id = idParam(req);
    const b = body(z.object({ verified: z.boolean() }), req);
    must(await supabase.rpc('admin_set_partner_verified', { p_company_id: id, p_verified: b.verified }));
    await audit(req, b.verified ? 'partner.verify' : 'partner.suspend', 'towing_company', id);
    res.json({ ok: true });
  }));

  // ---- Pricing ----
  app.get('/api/admin/pricing', A, wrap(async (_req, res) => {
    const [flat, hours, classes] = await Promise.all([
      supabase.from('service_flat_rates').select('service_code, flat_fee_zar').is('company_id', null).eq('active', true),
      supabase.from('pricing_settings').select('after_hours_start, after_hours_end, after_hours_multiplier').is('company_id', null).maybeSingle(),
      supabase.from('tow_service_classes').select('code, display_name').eq('is_active', true).order('sort_order'),
    ]);
    res.json({ flatRates: flat.data ?? [], afterHours: hours.data ?? null, towClasses: classes.data ?? [], services: SERVICES });
  }));

  app.post('/api/admin/pricing/flat-rate', A, wrap(async (req, res) => {
    const b = body(z.object({ companyId: uuid.nullable(), service: z.enum(SERVICES), fee: money.nullable() }), req);
    must(await supabase.rpc('admin_set_flat_rate', { p_company_id: b.companyId, p_service: b.service, p_fee: b.fee }));
    await audit(req, 'pricing.flat_rate', b.companyId ? 'towing_company' : 'platform', b.companyId, { service: b.service, fee: b.fee });
    res.json({ ok: true });
  }));

  app.post('/api/admin/pricing/after-hours', A, wrap(async (req, res) => {
    const b = body(z.object({ companyId: uuid.nullable(), start: hhmm, end: hhmm, multiplier: z.number().min(1).max(3) }), req);
    must(await supabase.rpc('admin_set_pricing_settings', { p_company_id: b.companyId, p_start: b.start, p_end: b.end, p_multiplier: b.multiplier }));
    await audit(req, 'pricing.after_hours', b.companyId ? 'towing_company' : 'platform', b.companyId, b);
    res.json({ ok: true });
  }));

  app.post('/api/admin/pricing/tow-rate', A, wrap(async (req, res) => {
    const b = body(z.object({ companyId: uuid, serviceClass: z.string().min(1).max(40), calloutFee: money, perKm: money, minimum: money }), req);
    must(await supabase.rpc('admin_set_tow_rate', { p_company_id: b.companyId, p_class: b.serviceClass, p_callout: b.calloutFee, p_per_km: b.perKm, p_minimum: b.minimum }));
    await audit(req, 'pricing.tow_rate', 'towing_company', b.companyId, b);
    res.json({ ok: true });
  }));

  // ---- Ratings ----
  app.get('/api/admin/ratings', A, wrap(async (req, res) => {
    const max = z.coerce.number().int().min(1).max(5).catch(5).parse(req.query.max);
    const visibility = z.enum(['visible', 'hidden', 'all']).catch('visible').parse(req.query.visibility);
    const companyId = uuid.safeParse(req.query.companyId);
    res.json({ ratings: must(await supabase.rpc('admin_ratings_list', { p_max_rating: max, p_visibility: visibility, p_company_id: companyId.success ? companyId.data : null, p_limit: 200 })) ?? [] });
  }));

  app.post('/api/admin/ratings/:id/visibility', A, wrap(async (req, res) => {
    const id = idParam(req);
    const b = body(z.object({ hidden: z.boolean() }), req);
    must(await supabase.from('request_ratings').update({ admin_hidden: b.hidden, admin_hidden_at: b.hidden ? new Date().toISOString() : null }).eq('id', id));
    await audit(req, b.hidden ? 'rating.hide' : 'rating.show', 'request_rating', id);
    res.json({ ok: true });
  }));

  // ---- Requests (read-only monitor) ----
  app.get('/api/admin/requests', A, wrap(async (req, res) => {
    const filter = z.enum(['all', 'open', 'completed', 'closed']).catch('all').parse(req.query.status);
    let q = supabase.from('tow_requests')
      .select('id, status, created_at, breakdown_type, estimated_distance_km, estimated_price_min, estimated_price_max, final_price, selected_company_id, contact_name, vehicle_registration, fare_surcharge_label')
      .order('created_at', { ascending: false }).limit(150);
    if (filter === 'open') q = q.in('status', ['pending', 'accepted', 'en_route', 'arrived']);
    else if (filter === 'completed') q = q.eq('status', 'completed');
    else if (filter === 'closed') q = q.in('status', ['cancelled', 'declined', 'expired']);
    const rows = must(await q) ?? [];
    const companyIds = [...new Set(rows.map((r) => r.selected_company_id).filter(Boolean))];
    const companies = companyIds.length ? (await supabase.from('towing_companies').select('id, company_name').in('id', companyIds)).data ?? [] : [];
    const nameBy = new Map(companies.map((c) => [c.id, c.company_name]));
    res.json({ requests: rows.map((r) => ({ ...r, companyName: nameBy.get(r.selected_company_id) ?? null })) });
  }));

  // ---- Team + activity log ----
  app.get('/api/admin/team', A, wrap(async (_req, res) => {
    const admins = must(await supabase.from('admin_users').select('user_id, created_at').order('created_at')) ?? [];
    const ids = admins.map((a) => a.user_id);
    const profiles = ids.length ? (await supabase.from('user_profiles').select('user_id, email').in('user_id', ids)).data ?? [] : [];
    const emailBy = new Map(profiles.map((p) => [p.user_id, p.email]));
    res.json({ admins: admins.map((a) => ({ ...a, email: emailBy.get(a.user_id) ?? '(no email)' })) });
  }));

  app.post('/api/admin/team', A, wrap(async (req, res) => {
    const b = body(z.object({ email: z.string().trim().toLowerCase().email().max(200) }), req);
    const profile = must(await supabase.from('user_profiles').select('user_id, email').eq('email', b.email).maybeSingle());
    if (!profile) throw fail(404, 'No account with that email yet. They must sign in to Towber once first, or be created in Supabase Auth.');
    must(await supabase.from('admin_users').upsert({ user_id: profile.user_id, created_by: req.admin.id }, { onConflict: 'user_id', ignoreDuplicates: true }));
    await audit(req, 'team.add', 'admin_user', profile.user_id, { email: profile.email });
    res.json({ ok: true });
  }));

  app.delete('/api/admin/team/:id', A, wrap(async (req, res) => {
    const id = idParam(req);
    if (id === req.admin.id) throw fail(400, 'You cannot remove your own admin access.');
    must(await supabase.from('admin_users').delete().eq('user_id', id));
    await audit(req, 'team.remove', 'admin_user', id);
    res.json({ ok: true });
  }));

  app.get('/api/admin/audit', A, wrap(async (_req, res) => {
    res.json({ log: must(await supabase.from('admin_audit_log').select('id, admin_email, action, entity, entity_id, details, created_at').order('created_at', { ascending: false }).limit(100)) ?? [] });
  }));
}
