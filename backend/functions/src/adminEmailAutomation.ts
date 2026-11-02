import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { createTransporter, getSmtpConfigFromEnv, EmailProviderConfig } from "./shared/email";
import { lookupTemplate, autoSeedIfMissing, DEFAULTS_EN } from "./adminEmailTemplates";

const SETTINGS_COLL = "email_automation_settings";
const SETTINGS_DOC = "global";

// ── Settings type ─────────────────────────────────────────────────────────────

type AutomationSettings = {
  // Email provider
  emailProvider: "smtp" | "ses";

  // SMTP settings (stored in Firestore; override env vars when smtpHost is set)
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string; // never returned to client — masked as "***"
  smtpFromEmail: string;
  smtpFromName: string;

  // SES settings
  sesRegion: string;
  sesAccessKeyId: string;
  sesSecretAccessKey: string; // never returned to client — masked as "***"
  sesFromEmail: string;
  sesFromName: string;

  // Purchase emails
  purchaseEmailEnabled: boolean;

  // Registration reminders (for unverified accounts)
  regReminderEnabled: boolean;
  regReminder1dEnabled: boolean;
  regReminder3dEnabled: boolean;
  regReminder7dEnabled: boolean;
  regReminderMaxPerRun: number;

  // Inactivity emails (multi-stage)
  inactivityEnabled: boolean;
  inactivity1dEnabled: boolean;
  inactivity3dEnabled: boolean;
  inactivity7dEnabled: boolean;
  inactivityMaxPerRun: number;

  // Legacy field (kept for backward compat)
  inactivityDays: number;

  // Stats
  lastRunAt: number | null;
  lastRunSent: number;
  lastRunFailed: number;
  // Legacy aliases
  lastInactivityRunAt: number | null;
  lastInactivityRunSent: number;
  lastInactivityRunFailed: number;
};

// ── Settings loader ───────────────────────────────────────────────────────────

async function loadSettings(): Promise<AutomationSettings> {
  const snap = await getDb().collection(SETTINGS_COLL).doc(SETTINGS_DOC).get();
  const d = snap.data() ?? {};
  return {
    emailProvider: d.emailProvider === "ses" ? "ses" : "smtp",

    // Prefer Firestore values; fall back to env vars so the form shows the current effective config
    smtpHost:      (d.smtpHost      as string | undefined) ?? process.env.SMTP_HOST      ?? "",
    smtpPort:      typeof d.smtpPort === "number" ? d.smtpPort : Number(process.env.SMTP_PORT ?? 587),
    smtpSecure:    d.smtpSecure !== undefined ? d.smtpSecure === true : process.env.SMTP_SECURE === "true",
    smtpUser:      (d.smtpUser      as string | undefined) ?? process.env.SMTP_USER      ?? "",
    smtpPass:      (d.smtpPass      as string | undefined) ?? (process.env.SMTP_PASS ? "ENV_SET" : ""),
    smtpFromEmail: (d.smtpFromEmail as string | undefined) ?? process.env.SMTP_FROM_EMAIL ?? "",
    smtpFromName:  (d.smtpFromName  as string | undefined) ?? process.env.SMTP_FROM_NAME  ?? "PlayTrap",

    sesRegion: d.sesRegion ?? "eu-west-1",
    sesAccessKeyId: d.sesAccessKeyId ?? "",
    sesSecretAccessKey: d.sesSecretAccessKey ?? "",
    sesFromEmail: d.sesFromEmail ?? "",
    sesFromName: d.sesFromName ?? "PlayTrap",

    purchaseEmailEnabled: d.purchaseEmailEnabled !== false,

    regReminderEnabled: d.regReminderEnabled !== false,
    regReminder1dEnabled: d.regReminder1dEnabled !== false,
    regReminder3dEnabled: d.regReminder3dEnabled !== false,
    regReminder7dEnabled: d.regReminder7dEnabled !== false,
    regReminderMaxPerRun: typeof d.regReminderMaxPerRun === "number" ? d.regReminderMaxPerRun : 200,

    inactivityEnabled: d.inactivityEnabled !== false,
    inactivity1dEnabled: d.inactivity1dEnabled !== false,
    inactivity3dEnabled: d.inactivity3dEnabled !== false,
    inactivity7dEnabled: d.inactivity7dEnabled !== false,
    inactivityMaxPerRun: typeof d.inactivityMaxPerRun === "number" ? d.inactivityMaxPerRun : 200,

    inactivityDays: typeof d.inactivityDays === "number" ? d.inactivityDays : 7,

    lastRunAt: d.lastRunAt instanceof Timestamp ? d.lastRunAt.toMillis() : null,
    lastRunSent: typeof d.lastRunSent === "number" ? d.lastRunSent : 0,
    lastRunFailed: typeof d.lastRunFailed === "number" ? d.lastRunFailed : 0,
    lastInactivityRunAt: d.lastInactivityRunAt instanceof Timestamp ? d.lastInactivityRunAt.toMillis() : null,
    lastInactivityRunSent: typeof d.lastInactivityRunSent === "number" ? d.lastInactivityRunSent : 0,
    lastInactivityRunFailed: typeof d.lastInactivityRunFailed === "number" ? d.lastInactivityRunFailed : 0,
  };
}

// ── Email provider config loader ──────────────────────────────────────────────

async function loadProviderConfig(): Promise<EmailProviderConfig> {
  const snap = await getDb().collection(SETTINGS_COLL).doc(SETTINGS_DOC).get();
  const d = snap.data() ?? {};

  if (d.emailProvider === "ses" && d.sesAccessKeyId && d.sesSecretAccessKey) {
    return {
      provider: "ses",
      region: (d.sesRegion as string) || "eu-west-1",
      accessKeyId: d.sesAccessKeyId as string,
      secretAccessKey: d.sesSecretAccessKey as string,
      fromEmail: (d.sesFromEmail as string | undefined) || process.env.SMTP_FROM_EMAIL || "",
      fromName: (d.sesFromName as string | undefined) || process.env.SMTP_FROM_NAME || "PlayTrap",
    };
  }

  // If SMTP is configured in Firestore (host set), use those instead of env vars
  if (d.smtpHost) {
    return {
      provider: "smtp",
      host: d.smtpHost as string,
      port: typeof d.smtpPort === "number" ? d.smtpPort : 587,
      secure: d.smtpSecure === true,
      user: (d.smtpUser as string) || "",
      pass: (d.smtpPass as string) || "",
      fromEmail: (d.smtpFromEmail as string) || process.env.SMTP_FROM_EMAIL || "",
      fromName: (d.smtpFromName as string) || process.env.SMTP_FROM_NAME || "PlayTrap",
    };
  }

  return getSmtpConfigFromEnv();
}

function getFromAddress(config: EmailProviderConfig): { fromEmail: string; fromName: string } {
  return {
    fromEmail: config.fromEmail || process.env.SMTP_FROM_EMAIL || "",
    fromName: config.fromName || process.env.SMTP_FROM_NAME || "PlayTrap",
  };
}

// ── Admin: get automation settings ────────────────────────────────────────────

export const adminGetEmailAutomationSettings = onCall(async (request) => {
  requireAdmin(request);
  const s = await loadSettings();
  const snap = await getDb().collection(SETTINGS_COLL).doc(SETTINGS_DOC).get();
  const d = snap.data() ?? {};
  // Tell the UI whether SMTP values come from Firestore or env vars
  const smtpSource = d.smtpHost ? "firestore" : (process.env.SMTP_HOST ? "env" : "none");
  return {
    ok: true,
    settings: {
      ...s,
      smtpPass: s.smtpPass ? "***" : "",
      smtpSource,
      sesSecretAccessKey: s.sesSecretAccessKey ? "***" : "",
    },
  };
});

// ── Admin: update automation settings ─────────────────────────────────────────

export const adminUpdateEmailAutomationSettings = onCall(async (request) => {
  requireAdmin(request);

  const p = (request.data ?? {}) as Record<string, unknown>;
  const db = getDb();

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

  // Provider selector
  if (p.emailProvider === "smtp" || p.emailProvider === "ses") update.emailProvider = p.emailProvider;

  // SMTP Firestore settings
  if (typeof p.smtpHost === "string") update.smtpHost = p.smtpHost;
  if (typeof p.smtpPort === "number" && p.smtpPort > 0) update.smtpPort = p.smtpPort;
  if (typeof p.smtpSecure === "boolean") update.smtpSecure = p.smtpSecure;
  if (typeof p.smtpUser === "string") update.smtpUser = p.smtpUser;
  if (typeof p.smtpPass === "string" && p.smtpPass !== "***") update.smtpPass = p.smtpPass;
  if (typeof p.smtpFromEmail === "string") update.smtpFromEmail = p.smtpFromEmail;
  if (typeof p.smtpFromName === "string") update.smtpFromName = p.smtpFromName;

  // SES settings
  if (typeof p.sesRegion === "string") update.sesRegion = p.sesRegion;
  if (typeof p.sesAccessKeyId === "string") update.sesAccessKeyId = p.sesAccessKeyId;
  if (typeof p.sesSecretAccessKey === "string" && p.sesSecretAccessKey !== "***") {
    update.sesSecretAccessKey = p.sesSecretAccessKey;
  }
  if (typeof p.sesFromEmail === "string") update.sesFromEmail = p.sesFromEmail;
  if (typeof p.sesFromName === "string") update.sesFromName = p.sesFromName;

  // Purchase
  if (typeof p.purchaseEmailEnabled === "boolean") update.purchaseEmailEnabled = p.purchaseEmailEnabled;

  // Registration reminders
  if (typeof p.regReminderEnabled === "boolean") update.regReminderEnabled = p.regReminderEnabled;
  if (typeof p.regReminder1dEnabled === "boolean") update.regReminder1dEnabled = p.regReminder1dEnabled;
  if (typeof p.regReminder3dEnabled === "boolean") update.regReminder3dEnabled = p.regReminder3dEnabled;
  if (typeof p.regReminder7dEnabled === "boolean") update.regReminder7dEnabled = p.regReminder7dEnabled;
  if (typeof p.regReminderMaxPerRun === "number" && p.regReminderMaxPerRun >= 1) {
    update.regReminderMaxPerRun = p.regReminderMaxPerRun;
  }

  // Inactivity
  if (typeof p.inactivityEnabled === "boolean") update.inactivityEnabled = p.inactivityEnabled;
  if (typeof p.inactivity1dEnabled === "boolean") update.inactivity1dEnabled = p.inactivity1dEnabled;
  if (typeof p.inactivity3dEnabled === "boolean") update.inactivity3dEnabled = p.inactivity3dEnabled;
  if (typeof p.inactivity7dEnabled === "boolean") update.inactivity7dEnabled = p.inactivity7dEnabled;
  if (typeof p.inactivityMaxPerRun === "number" && p.inactivityMaxPerRun >= 1) {
    update.inactivityMaxPerRun = p.inactivityMaxPerRun;
  }
  // Legacy
  if (typeof p.inactivityDays === "number" && p.inactivityDays >= 1) update.inactivityDays = p.inactivityDays;

  await db.collection(SETTINGS_COLL).doc(SETTINGS_DOC).set(update, { merge: true });
  return { ok: true };
});

// ── Internal: purchase confirmation email ──────────────────────────────────────

export async function sendPurchaseEmailInternal(params: {
  uid: string;
  packageName?: string | null;
  amount?: number | null;
  currency?: string | null;
  transactionId?: string | null;
  membershipExpiresAt?: Date | null;
}): Promise<void> {
  const settings = await loadSettings();
  if (!settings.purchaseEmailEnabled) return;

  const db = getDb();
  const userSnap = await db.collection("users").doc(params.uid).get();
  if (!userSnap.exists) return;

  const user = userSnap.data()!;
  const email = user.email as string | undefined;
  if (!email) return;

  const displayName = (user.displayName ?? user.username ?? email.split("@")[0]) as string;
  const userLocale = ((user.locale ?? "en") as string).trim().toLowerCase();

  void autoSeedIfMissing("system_purchase");
  const tmplData = await lookupTemplate("system_purchase", userLocale);

  const subject = tmplData?.subject ?? DEFAULTS_EN.system_purchase.subject;
  const rawHtml = tmplData?.bodyHtml ?? DEFAULTS_EN.system_purchase.bodyHtml;
  const rawText = tmplData?.bodyText ?? DEFAULTS_EN.system_purchase.bodyText;

  const expiresStr = params.membershipExpiresAt
    ? params.membershipExpiresAt.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
    : "—";

  const substitute = (tpl: string) =>
    tpl
      .replace(/\{\{name\}\}/g, displayName)
      .replace(/\{\{packageName\}\}/g, params.packageName ?? "—")
      .replace(/\{\{amount\}\}/g, params.amount != null ? String((params.amount / 100).toFixed(2)) : "—")
      .replace(/\{\{currency\}\}/g, params.currency ?? "EUR")
      .replace(/\{\{transactionId\}\}/g, params.transactionId ?? "—")
      .replace(/\{\{expiresAt\}\}/g, expiresStr);

  const config = await loadProviderConfig();
  const transporter = createTransporter(config);
  const { fromEmail, fromName } = getFromAddress(config);

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject: substitute(subject),
    html: substitute(rawHtml),
    text: substitute(rawText),
  });
}

// ── Internal: registration reminder batch ─────────────────────────────────────

type StageResult = { sent: number; failed: number; skipped: number };

async function runRegistrationReminders(
  settings: AutomationSettings,
  dryRun: boolean
): Promise<StageResult & { breakdown: Record<string, number> }> {
  const db = getDb();
  const config = dryRun ? null : await loadProviderConfig();
  const transporter = config ? createTransporter(config) : null;
  const { fromEmail, fromName } = config ? getFromAddress(config) : { fromEmail: "", fromName: "PlayTrap" };

  void autoSeedIfMissing("system_reg_unverified_1d");
  void autoSeedIfMissing("system_reg_unverified_3d");
  void autoSeedIfMissing("system_reg_unverified_7d");

  const now = Date.now();
  const cutoff1d = Timestamp.fromMillis(now - 1 * 24 * 60 * 60 * 1000);
  const cutoff3d = Timestamp.fromMillis(now - 3 * 24 * 60 * 60 * 1000);
  const cutoff7d = Timestamp.fromMillis(now - 7 * 24 * 60 * 60 * 1000);

  // Query unverified users created at least 1 day ago
  const usersSnap = await db
    .collection("users")
    .where("emailVerified", "==", false)
    .where("createdAt", "<", cutoff1d)
    .limit(settings.regReminderMaxPerRun)
    .get();

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const breakdown: Record<string, number> = { "1d": 0, "3d": 0, "7d": 0 };

  for (const doc of usersSnap.docs) {
    const user = doc.data();
    const email = user.email as string | undefined;
    if (!email) { skipped++; continue; }

    const createdAt = user.createdAt as Timestamp | undefined;
    if (!createdAt) { skipped++; continue; }

    // Determine highest pending stage
    let stage: "7d" | "3d" | "1d" | null = null;
    let templateType: "system_reg_unverified_7d" | "system_reg_unverified_3d" | "system_reg_unverified_1d" | null = null;
    let stageField: string | null = null;

    if (settings.regReminder7dEnabled && createdAt < cutoff7d && !user.sentEmailStage_reg_7d) {
      stage = "7d";
      templateType = "system_reg_unverified_7d";
      stageField = "sentEmailStage_reg_7d";
    } else if (settings.regReminder3dEnabled && createdAt < cutoff3d && !user.sentEmailStage_reg_3d) {
      stage = "3d";
      templateType = "system_reg_unverified_3d";
      stageField = "sentEmailStage_reg_3d";
    } else if (settings.regReminder1dEnabled && !user.sentEmailStage_reg_1d) {
      stage = "1d";
      templateType = "system_reg_unverified_1d";
      stageField = "sentEmailStage_reg_1d";
    }

    if (!stage || !templateType || !stageField) { skipped++; continue; }

    if (dryRun) { sent++; breakdown[stage]++; continue; }

    try {
      const userLocale = ((user.locale ?? "en") as string).trim().toLowerCase();
      const displayName = (user.displayName ?? user.username ?? email.split("@")[0]) as string;

      // Generate a new verification link
      let verificationLink = "https://playtrapnow.com";
      try {
        const authUser = await getAuth().getUserByEmail(email);
        verificationLink = await getAuth().generateEmailVerificationLink(authUser.email!);
      } catch { /* use fallback link */ }

      const tmplData = await lookupTemplate(templateType, userLocale);
      const subject = tmplData?.subject ?? DEFAULTS_EN[templateType].subject;
      const rawHtml = tmplData?.bodyHtml ?? DEFAULTS_EN[templateType].bodyHtml;
      const rawText = tmplData?.bodyText ?? DEFAULTS_EN[templateType].bodyText;

      const substitute = (tpl: string) =>
        tpl
          .replace(/\{\{name\}\}/g, displayName)
          .replace(/\{\{verificationLink\}\}/g, verificationLink);

      await transporter!.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: substitute(subject),
        html: substitute(rawHtml),
        text: substitute(rawText),
      });

      await doc.ref.set(
        { [stageField]: FieldValue.serverTimestamp() },
        { merge: true }
      );
      sent++;
      breakdown[stage]++;
    } catch {
      failed++;
    }
  }

  return { sent, failed, skipped, breakdown };
}

// ── Internal: inactivity email batch (multi-stage) ────────────────────────────

async function runInactivityEmailsMultiStage(
  settings: AutomationSettings,
  dryRun: boolean
): Promise<StageResult & { breakdown: Record<string, number> }> {
  const db = getDb();
  const config = dryRun ? null : await loadProviderConfig();
  const transporter = config ? createTransporter(config) : null;
  const { fromEmail, fromName } = config ? getFromAddress(config) : { fromEmail: "", fromName: "PlayTrap" };

  void autoSeedIfMissing("system_inactive_1d");
  void autoSeedIfMissing("system_inactive_3d");
  void autoSeedIfMissing("system_inactive_7d");

  const now = Date.now();
  const cutoff1d = Timestamp.fromMillis(now - 1 * 24 * 60 * 60 * 1000);
  const cutoff3d = Timestamp.fromMillis(now - 3 * 24 * 60 * 60 * 1000);
  const cutoff7d = Timestamp.fromMillis(now - 7 * 24 * 60 * 60 * 1000);

  // Query verified users who haven't been seen in at least 1 day
  const usersSnap = await db
    .collection("users")
    .where("emailVerified", "==", true)
    .where("lastSeenAt", "<", cutoff1d)
    .limit(settings.inactivityMaxPerRun)
    .get();

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const breakdown: Record<string, number> = { "1d": 0, "3d": 0, "7d": 0 };

  for (const doc of usersSnap.docs) {
    const user = doc.data();
    const email = user.email as string | undefined;
    if (!email) { skipped++; continue; }

    const lastSeenAt = user.lastSeenAt as Timestamp | undefined;
    if (!lastSeenAt) { skipped++; continue; }

    // Determine highest pending stage (a stage is "pending" if not sent since lastSeenAt)
    const stageSent7d = user.sentEmailStage_inactive_7d as Timestamp | undefined;
    const stageSent3d = user.sentEmailStage_inactive_3d as Timestamp | undefined;
    const stageSent1d = user.sentEmailStage_inactive_1d as Timestamp | undefined;

    const notSentSince = (ts: Timestamp | undefined) =>
      !ts || ts.toMillis() <= lastSeenAt.toMillis();

    let stage: "7d" | "3d" | "1d" | null = null;
    let templateType: "system_inactive_7d" | "system_inactive_3d" | "system_inactive_1d" | null = null;
    let stageField: string | null = null;

    if (settings.inactivity7dEnabled && lastSeenAt < cutoff7d && notSentSince(stageSent7d)) {
      stage = "7d";
      templateType = "system_inactive_7d";
      stageField = "sentEmailStage_inactive_7d";
    } else if (settings.inactivity3dEnabled && lastSeenAt < cutoff3d && notSentSince(stageSent3d)) {
      stage = "3d";
      templateType = "system_inactive_3d";
      stageField = "sentEmailStage_inactive_3d";
    } else if (settings.inactivity1dEnabled && notSentSince(stageSent1d)) {
      stage = "1d";
      templateType = "system_inactive_1d";
      stageField = "sentEmailStage_inactive_1d";
    }

    if (!stage || !templateType || !stageField) { skipped++; continue; }

    if (dryRun) { sent++; breakdown[stage]++; continue; }

    try {
      const userLocale = ((user.locale ?? "en") as string).trim().toLowerCase();
      const displayName = (user.displayName ?? user.username ?? email.split("@")[0]) as string;
      const username = (user.username ?? displayName) as string;

      const tmplData = await lookupTemplate(templateType, userLocale);
      const subject = tmplData?.subject ?? DEFAULTS_EN[templateType].subject;
      const rawHtml = tmplData?.bodyHtml ?? DEFAULTS_EN[templateType].bodyHtml;
      const rawText = tmplData?.bodyText ?? DEFAULTS_EN[templateType].bodyText;

      const substitute = (tpl: string) =>
        tpl
          .replace(/\{\{name\}\}/g, displayName)
          .replace(/\{\{username\}\}/g, username);

      await transporter!.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: substitute(subject),
        html: substitute(rawHtml),
        text: substitute(rawText),
      });

      await doc.ref.set(
        { [stageField]: FieldValue.serverTimestamp() },
        { merge: true }
      );
      sent++;
      breakdown[stage]++;
    } catch {
      failed++;
    }
  }

  return { sent, failed, skipped, breakdown };
}

// ── Admin: manual trigger for all automation emails ───────────────────────────

export const adminTriggerInactivityEmails = onCall(
  { timeoutSeconds: 540 },
  async (request) => {
    requireAdmin(request);

    const { dryRun = false, overrideSettings } = (request.data ?? {}) as {
      dryRun?: boolean;
      overrideSettings?: Partial<AutomationSettings>;
    };

    const settings = await loadSettings();
    const effective = { ...settings, ...overrideSettings };

    let regResult = { sent: 0, failed: 0, skipped: 0, breakdown: {} as Record<string, number> };
    let inactivityResult = { sent: 0, failed: 0, skipped: 0, breakdown: {} as Record<string, number> };

    if (effective.regReminderEnabled) {
      regResult = await runRegistrationReminders(effective, dryRun);
    }
    if (effective.inactivityEnabled) {
      inactivityResult = await runInactivityEmailsMultiStage(effective, dryRun);
    }

    const totalSent = regResult.sent + inactivityResult.sent;
    const totalFailed = regResult.failed + inactivityResult.failed;

    if (!dryRun) {
      await getDb().collection(SETTINGS_COLL).doc(SETTINGS_DOC).set(
        {
          lastRunAt: FieldValue.serverTimestamp(),
          lastRunSent: totalSent,
          lastRunFailed: totalFailed,
          // legacy aliases
          lastInactivityRunAt: FieldValue.serverTimestamp(),
          lastInactivityRunSent: inactivityResult.sent,
          lastInactivityRunFailed: inactivityResult.failed,
        },
        { merge: true }
      );
    }

    return {
      ok: true,
      dryRun,
      sent: totalSent,
      failed: totalFailed,
      skipped: regResult.skipped + inactivityResult.skipped,
      total: regResult.sent + regResult.failed + regResult.skipped +
             inactivityResult.sent + inactivityResult.failed + inactivityResult.skipped,
      registration: regResult,
      inactivity: inactivityResult,
    };
  }
);

// ── Scheduled: daily automation run ──────────────────────────────────────────

export const scheduledInactivityEmails = onSchedule(
  {
    schedule: "every day 09:00",
    region: "europe-west1",
    timeZone: "Europe/Budapest",
    timeoutSeconds: 540,
  },
  async () => {
    const settings = await loadSettings();

    let totalSent = 0;
    let totalFailed = 0;
    let inactivitySent = 0;
    let inactivityFailed = 0;

    if (settings.regReminderEnabled) {
      const r = await runRegistrationReminders(settings, false);
      totalSent += r.sent;
      totalFailed += r.failed;
    }

    if (settings.inactivityEnabled) {
      const r = await runInactivityEmailsMultiStage(settings, false);
      totalSent += r.sent;
      totalFailed += r.failed;
      inactivitySent = r.sent;
      inactivityFailed = r.failed;
    }

    await getDb().collection(SETTINGS_COLL).doc(SETTINGS_DOC).set(
      {
        lastRunAt: FieldValue.serverTimestamp(),
        lastRunSent: totalSent,
        lastRunFailed: totalFailed,
        // legacy aliases
        lastInactivityRunAt: FieldValue.serverTimestamp(),
        lastInactivityRunSent: inactivitySent,
        lastInactivityRunFailed: inactivityFailed,
      },
      { merge: true }
    );
  }
);

