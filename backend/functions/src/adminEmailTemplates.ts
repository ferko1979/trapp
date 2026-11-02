import { FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { requireAppCheck } from "./shared/appCheck";
import { getMailer } from "./shared/email";

export const COLL = "email_templates";
const AI_KEYS_DOC = ["admin_config", "ai_keys"] as const;
const SUPPORTED_LOCALES = ["en", "hu", "sk", "ro", "de", "hr", "he"];
const LOCALE_NAMES: Record<string, string> = {
  en: "English", hu: "Magyar (Hungarian)", sk: "Slovenčina (Slovak)",
  ro: "Română (Romanian)", de: "Deutsch (German)", hr: "Hrvatski (Croatian)",
  he: "עברית (Hebrew)",
};

// ── System template types ──────────────────────────────────────────────────────
export type SystemTemplateType =
  | "system_password_reset"
  | "system_email_verification"
  | "system_welcome"
  | "system_purchase"
  | "system_inactive"
  | "system_reg_unverified_1d"
  | "system_reg_unverified_3d"
  | "system_reg_unverified_7d"
  | "system_inactive_1d"
  | "system_inactive_3d"
  | "system_inactive_7d";

export const SYSTEM_TEMPLATE_TYPES: SystemTemplateType[] = [
  "system_password_reset",
  "system_email_verification",
  "system_welcome",
  "system_purchase",
  "system_inactive",
  "system_reg_unverified_1d",
  "system_reg_unverified_3d",
  "system_reg_unverified_7d",
  "system_inactive_1d",
  "system_inactive_3d",
  "system_inactive_7d",
];

export const SYSTEM_TEMPLATE_LABELS: Record<SystemTemplateType, string> = {
  system_password_reset: "Password Reset",
  system_email_verification: "Email Verification",
  system_welcome: "Welcome Email",
  system_purchase: "Purchase Confirmation",
  system_inactive: "We Miss You (Inactivity)",
  system_reg_unverified_1d: "Not Verified: 1-Day Reminder",
  system_reg_unverified_3d: "Not Verified: 3-Day Reminder",
  system_reg_unverified_7d: "Not Verified: 7-Day Final Notice",
  system_inactive_1d: "Inactive: Day 1 Nudge",
  system_inactive_3d: "Inactive: Day 3 Comeback",
  system_inactive_7d: "Inactive: Day 7 Re-engagement",
};

// ── English default templates ──────────────────────────────────────────────────
export const DEFAULTS_EN: Record<SystemTemplateType, { subject: string; bodyHtml: string; bodyText: string; variables: string[] }> = {
  system_password_reset: {
    subject: "Reset your PlayTrap password",
    variables: ["{{name}}", "{{resetLink}}"],
    bodyText: "Hello {{name}},\n\nReset your PlayTrap password by visiting:\n{{resetLink}}\n\nIf you did not request this, please ignore this email.",
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a2e;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1d4ed8;font-size:22px;margin:0;">🪤 PlayTrap</h1>
  </div>
  <h2 style="font-size:20px;margin:0 0 12px;">Reset your password</h2>
  <p style="color:#374151;line-height:1.6;">Hello <strong>{{name}}</strong>,</p>
  <p style="color:#374151;line-height:1.6;">We received a request to reset your PlayTrap password. Click the button below to choose a new one:</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="{{resetLink}}" style="display:inline-block;padding:14px 32px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
      Reset Password
    </a>
  </div>
  <p style="color:#6b7280;font-size:13px;line-height:1.6;">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password will remain unchanged.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;text-align:center;">PlayTrap · playtrapnow.com</p>
</div>`,
  },
  system_email_verification: {
    subject: "Verify your PlayTrap email address",
    variables: ["{{name}}", "{{verificationLink}}"],
    bodyText: "Hello {{name}},\n\nVerify your PlayTrap email address by visiting:\n{{verificationLink}}\n\nIf you did not sign up for PlayTrap, please ignore this email.",
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a2e;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1d4ed8;font-size:22px;margin:0;">🪤 PlayTrap</h1>
  </div>
  <h2 style="font-size:20px;margin:0 0 12px;">Verify your email</h2>
  <p style="color:#374151;line-height:1.6;">Hello <strong>{{name}}</strong>,</p>
  <p style="color:#374151;line-height:1.6;">Thanks for signing up! Please verify your email address to activate your PlayTrap account:</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="{{verificationLink}}" style="display:inline-block;padding:14px 32px;background:#059669;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
      Verify Email
    </a>
  </div>
  <p style="color:#6b7280;font-size:13px;line-height:1.6;">If you did not create a PlayTrap account, you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;text-align:center;">PlayTrap · playtrapnow.com</p>
</div>`,
  },
  system_welcome: {
    subject: "Welcome to PlayTrap, {{name}}!",
    variables: ["{{name}}", "{{username}}"],
    bodyText: "Hello {{name}},\n\nWelcome to PlayTrap! Your username is {{username}}.\n\nStart placing traps and catching other players — good luck!",
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a2e;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1d4ed8;font-size:22px;margin:0;">🪤 PlayTrap</h1>
  </div>
  <h2 style="font-size:20px;margin:0 0 12px;">Welcome, {{name}}!</h2>
  <p style="color:#374151;line-height:1.6;">Your account is ready. Your username is <strong>{{username}}</strong>.</p>
  <p style="color:#374151;line-height:1.6;">Head into the map, place your first trap, and start catching other players. Good luck out there! 🎯</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="https://playtrapnow.com" style="display:inline-block;padding:14px 32px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
      Open PlayTrap
    </a>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;text-align:center;">PlayTrap · playtrapnow.com</p>
</div>`,
  },
  system_purchase: {
    subject: "Your PlayTrap purchase is confirmed 🎉",
    variables: ["{{name}}", "{{packageName}}", "{{amount}}", "{{currency}}", "{{transactionId}}", "{{expiresAt}}"],
    bodyText: "Hello {{name}},\n\nThank you for your purchase!\n\nPackage: {{packageName}}\nAmount: {{amount}} {{currency}}\nTransaction ID: {{transactionId}}\nActive until: {{expiresAt}}\n\nEnjoy your PlayTrap membership!",
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a2e;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1d4ed8;font-size:22px;margin:0;">🩤 PlayTrap</h1>
  </div>
  <h2 style="font-size:20px;margin:0 0 4px;">Purchase confirmed 🎉</h2>
  <p style="color:#374151;line-height:1.6;">Hello <strong>{{name}}</strong>, thank you for supporting PlayTrap!</p>
  <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:18px 20px;margin:20px 0;">
    <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
      <tr><td style="padding:6px 0;color:#64748b;font-weight:600;">Package</td><td style="padding:6px 0;color:#1e293b;text-align:right;font-weight:700;">{{packageName}}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;font-weight:600;">Amount</td><td style="padding:6px 0;color:#1e293b;text-align:right;">{{amount}} {{currency}}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;font-weight:600;">Active until</td><td style="padding:6px 0;color:#059669;text-align:right;font-weight:700;">{{expiresAt}}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;font-weight:600;">Transaction</td><td style="padding:6px 0;color:#94a3b8;text-align:right;font-size:0.78rem;">{{transactionId}}</td></tr>
    </table>
  </div>
  <p style="color:#374151;line-height:1.6;">Your membership is now active. Jump back into the map and enjoy your premium features! 🎯</p>
  <div style="text-align:center;margin:24px 0;">
    <a href="https://playtrapnow.com" style="display:inline-block;padding:14px 32px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
      Open PlayTrap
    </a>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;text-align:center;">PlayTrap · playtrapnow.com</p>
</div>`,
  },
  system_inactive: {
    subject: "We miss you in PlayTrap, {{name}}! 👋",
    variables: ["{{name}}", "{{username}}", "{{daysSinceActive}}"],
    bodyText: "Hello {{name}},\n\nIt’s been {{daysSinceActive}} days since we last saw you on PlayTrap. Traps are waiting!\n\nYour username is {{username}}. Head back into the map and start hunting again.",
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a2e;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1d4ed8;font-size:22px;margin:0;">🪤 PlayTrap</h1>
  </div>
  <h2 style="font-size:20px;margin:0 0 12px;">We miss you, {{name}}! 👋</h2>
  <p style="color:#374151;line-height:1.6;">It’s been <strong>{{daysSinceActive}} days</strong> since we last saw you. Your traps are still out there waiting — and so are your rivals!</p>
  <p style="color:#374151;line-height:1.6;">Come back as <strong>{{username}}</strong> and reclaim your spot on the map. 🗺️</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="https://playtrapnow.com" style="display:inline-block;padding:14px 32px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
      Jump Back In
    </a>
  </div>
  <p style="color:#9ca3af;font-size:13px;text-align:center;margin-top:24px;">Don’t want these reminders? Reply to this email and we’ll stop sending them.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;text-align:center;">PlayTrap · playtrapnow.com</p>
</div>`,
  },

  // ── Registration reminder stages ───────────────────────────────────────────

  system_reg_unverified_1d: {
    subject: "Don’t forget — verify your PlayTrap account",
    variables: ["{{name}}", "{{verificationLink}}"],
    bodyText: "Hello {{name}},\n\nYou signed up for PlayTrap but haven’t verified your email yet. Please verify now to activate your account:\n\n{{verificationLink}}\n\nIf you didn’t sign up, you can safely ignore this email.",
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a2e;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1d4ed8;font-size:22px;margin:0;">🪤 PlayTrap</h1>
  </div>
  <h2 style="font-size:20px;margin:0 0 12px;">One step left, {{name}}!</h2>
  <p style="color:#374151;line-height:1.6;">You created a PlayTrap account yesterday but haven’t verified your email yet. Just one click and you’re in:</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="{{verificationLink}}" style="display:inline-block;padding:14px 32px;background:#059669;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
      Verify My Email
    </a>
  </div>
  <p style="color:#6b7280;font-size:13px;line-height:1.6;">If the button doesn’t work, copy this link: {{verificationLink}}</p>
  <p style="color:#6b7280;font-size:13px;line-height:1.6;">If you didn’t sign up for PlayTrap, you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;text-align:center;">PlayTrap · playtrapnow.com</p>
</div>`,
  },

  system_reg_unverified_3d: {
    subject: "Still waiting on your PlayTrap verification…",
    variables: ["{{name}}", "{{verificationLink}}"],
    bodyText: "Hello {{name}},\n\nYour PlayTrap account is still waiting for email verification. Don’t lose your spot — verify now:\n\n{{verificationLink}}\n\nThis is a friendly reminder. If you didn’t sign up, you can ignore this email.",
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a2e;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1d4ed8;font-size:22px;margin:0;">🪤 PlayTrap</h1>
  </div>
  <h2 style="font-size:20px;margin:0 0 12px;">Your account is still waiting, {{name}}</h2>
  <p style="color:#374151;line-height:1.6;">It’s been 3 days since you signed up for PlayTrap, but your email isn’t verified yet. Other players are already placing traps — don’t miss out!</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="{{verificationLink}}" style="display:inline-block;padding:14px 32px;background:#059669;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
      Verify My Email Now
    </a>
  </div>
  <p style="color:#6b7280;font-size:13px;line-height:1.6;">If the button doesn’t work, copy this link: {{verificationLink}}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;text-align:center;">PlayTrap · playtrapnow.com</p>
</div>`,
  },

  system_reg_unverified_7d: {
    subject: "Last chance — complete your PlayTrap registration",
    variables: ["{{name}}", "{{verificationLink}}"],
    bodyText: "Hello {{name}},\n\nThis is your final reminder to verify your PlayTrap email address. Your account will remain inactive until you do:\n\n{{verificationLink}}\n\nIf you no longer want an account, no action is needed.",
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a2e;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1d4ed8;font-size:22px;margin:0;">🪤 PlayTrap</h1>
  </div>
  <h2 style="font-size:20px;margin:0 0 12px;">Final reminder, {{name}}</h2>
  <p style="color:#374151;line-height:1.6;">A week has passed since you registered for PlayTrap, but your account is still not active. This is our last reminder — verify your email to start playing:</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="{{verificationLink}}" style="display:inline-block;padding:14px 32px;background:#dc2626;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
      Activate My Account
    </a>
  </div>
  <p style="color:#6b7280;font-size:13px;line-height:1.6;">If the button doesn’t work, copy this link: {{verificationLink}}</p>
  <p style="color:#6b7280;font-size:13px;line-height:1.6;">If you’ve changed your mind, simply ignore this email — no action is needed.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;text-align:center;">PlayTrap · playtrapnow.com</p>
</div>`,
  },

  // ── Inactivity multi-stage emails ──────────────────────────────────────────

  system_inactive_1d: {
    subject: "Hey {{name}}, haven’t seen you today 👀",
    variables: ["{{name}}", "{{username}}"],
    bodyText: "Hello {{name}},\n\nWe noticed you haven’t opened PlayTrap today. Your traps are still active and your rivals are on the move!\n\nJump back in as {{username}} and keep your lead.",
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a2e;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1d4ed8;font-size:22px;margin:0;">🪤 PlayTrap</h1>
  </div>
  <h2 style="font-size:20px;margin:0 0 12px;">Your traps are calling, {{name}}!</h2>
  <p style="color:#374151;line-height:1.6;">We noticed you haven’t been in the game today. Your rivals are moving — don’t let them get the drop on you!</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="https://playtrapnow.com" style="display:inline-block;padding:14px 32px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
      Check My Traps
    </a>
  </div>
  <p style="color:#9ca3af;font-size:13px;text-align:center;margin-top:24px;">Don’t want these reminders? Reply to this email and we’ll stop sending them.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;text-align:center;">PlayTrap · playtrapnow.com</p>
</div>`,
  },

  system_inactive_3d: {
    subject: "We miss you, {{name}}! It’s been 3 days 🎯",
    variables: ["{{name}}", "{{username}}"],
    bodyText: "Hello {{name}},\n\nIt’s been 3 days since you last played PlayTrap. Your traps are still waiting, and so are your rivals!\n\nCome back as {{username}} and show them who’s boss.",
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a2e;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1d4ed8;font-size:22px;margin:0;">🪤 PlayTrap</h1>
  </div>
  <h2 style="font-size:20px;margin:0 0 12px;">3 days without traps, {{name}}? 😮</h2>
  <p style="color:#374151;line-height:1.6;">Your rivals have been busy while you’ve been away. It’s time to come back and reclaim your territory!</p>
  <p style="color:#374151;line-height:1.6;">Log back in as <strong>{{username}}</strong> and get back in the game. 🗺️</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="https://playtrapnow.com" style="display:inline-block;padding:14px 32px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
      Jump Back In
    </a>
  </div>
  <p style="color:#9ca3af;font-size:13px;text-align:center;margin-top:24px;">Don’t want these reminders? Reply to this email and we’ll stop sending them.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;text-align:center;">PlayTrap · playtrapnow.com</p>
</div>`,
  },

  system_inactive_7d: {
    subject: "A week without PlayTrap — we’re worried about you, {{name}} 😢",
    variables: ["{{name}}", "{{username}}"],
    bodyText: "Hello {{name}},\n\nIt’s been a whole week since you last played PlayTrap. We really miss you!\n\nYour traps are still out there and your spot on the leaderboard awaits. Come back as {{username}} — we’ve saved your place.",
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a2e;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1d4ed8;font-size:22px;margin:0;">🪤 PlayTrap</h1>
  </div>
  <h2 style="font-size:20px;margin:0 0 12px;">A whole week, {{name}}? We miss you! 😢</h2>
  <p style="color:#374151;line-height:1.6;">It’s been 7 days since we last saw <strong>{{username}}</strong> on the map. Your rivals have been claiming territory — but it’s not too late to take it back!</p>
  <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:16px 20px;margin:20px 0;">
    <p style="color:#92400e;margin:0;font-size:0.9rem;line-height:1.6;">🎯 <strong>Special comeback tip:</strong> Start by checking your active traps and see who’s been in your territory while you were gone!</p>
  </div>
  <div style="text-align:center;margin:28px 0;">
    <a href="https://playtrapnow.com" style="display:inline-block;padding:14px 32px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
      Return to PlayTrap
    </a>
  </div>
  <p style="color:#9ca3af;font-size:13px;text-align:center;margin-top:24px;">Don’t want these reminders? Reply to this email and we’ll stop sending them.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;text-align:center;">PlayTrap · playtrapnow.com</p>
</div>`,
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getAnthropicApiKey(): Promise<string> {
  const snap = await getDb().collection(AI_KEYS_DOC[0]).doc(AI_KEYS_DOC[1]).get();
  const key = snap.data()?.anthropicApiKey;
  if (!key || typeof key !== "string") {
    throw new HttpsError(
      "failed-precondition",
      "Anthropic API key not configured. Go to Admin Tools → AI / API Keys."
    );
  }
  return key as string;
}

export async function lookupTemplate(type: string, locale: string) {
  const db = getDb();
  const snap = await db.collection(COLL)
    .where("type", "==", type)
    .where("locale", "==", locale)
    .limit(1)
    .get();
  if (!snap.empty) return snap.docs[0].data();
  if (locale !== "en") {
    const enSnap = await db.collection(COLL)
      .where("type", "==", type)
      .where("locale", "==", "en")
      .limit(1)
      .get();
    if (!enSnap.empty) return enSnap.docs[0].data();
  }
  return null;
}

// ── Internal: auto-seed English defaults if missing ───────────────────────────
export async function autoSeedIfMissing(type: SystemTemplateType) {
  const db = getDb();
  const snap = await db.collection(COLL)
    .where("type", "==", type)
    .where("locale", "==", "en")
    .limit(1)
    .get();
  if (!snap.empty) return;
  const def = DEFAULTS_EN[type];
  await db.collection(COLL).add({
    name: `${SYSTEM_TEMPLATE_LABELS[type]} — English`,
    subject: def.subject,
    bodyHtml: def.bodyHtml,
    bodyText: def.bodyText,
    type,
    locale: "en",
    variables: def.variables,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// ── Public: send password reset using custom template ──────────────────────────
export const sendPasswordResetCustom = onCall(async (request) => {
  requireAppCheck(request);

  const { email, locale } = (request.data ?? {}) as { email?: string; locale?: string };
  if (!email?.trim()) throw new HttpsError("invalid-argument", "email is required");

  const normalizedEmail = email.trim().toLowerCase();
  let userLocale = (locale ?? "").trim().toLowerCase();

  // If no locale provided by the app, look up the stored locale from the user's Firestore doc
  if (!userLocale) {
    try {
      const authUser = await getAuth().getUserByEmail(normalizedEmail);
      const db = getDb();
      const userSnap = await db.collection("users").doc(authUser.uid).get();
      userLocale = (userSnap.data()?.locale as string | undefined)?.trim().toLowerCase() ?? "en";
    } catch { userLocale = "en"; }
  }

  // Rate limit: 1 per email per 60 s (prevents enumeration + abuse)
  const db = getDb();
  const rlRef = db.collection("_rate_limits").doc(`pw_reset_${normalizedEmail.replace(/[^a-z0-9]/g, "_")}`);
  const rlSnap = await rlRef.get();
  if (rlSnap.exists) {
    const lastMs = (rlSnap.data()?.sentAtMs as number | undefined) ?? 0;
    if (Date.now() - lastMs < 60_000) {
      return { ok: true }; // silent success — don't reveal timing
    }
  }

  // Always set the rate limit before doing anything else
  await rlRef.set({ sentAtMs: Date.now() }, { merge: true });

  try {
    void autoSeedIfMissing("system_password_reset");
    const link = await getAuth().generatePasswordResetLink(normalizedEmail);

    // Look up user display name for personalisation
    let displayName = "Player";
    try {
      const user = await getAuth().getUserByEmail(normalizedEmail);
      displayName = user.displayName ?? user.email?.split("@")[0] ?? "Player";
    } catch { /* non-fatal */ }

    const tmplData = await lookupTemplate("system_password_reset", userLocale);

    const subject = tmplData?.subject ?? "Reset your PlayTrap password";
    const rawHtml = tmplData?.bodyHtml ?? DEFAULTS_EN.system_password_reset.bodyHtml;
    const rawText = tmplData?.bodyText ?? DEFAULTS_EN.system_password_reset.bodyText;

    const html = rawHtml
      .replace(/\{\{name\}\}/g, displayName)
      .replace(/\{\{resetLink\}\}/g, link);
    const text = rawText
      .replace(/\{\{name\}\}/g, displayName)
      .replace(/\{\{resetLink\}\}/g, link);

    const transporter = getMailer();
    const fromEmail = process.env.SMTP_FROM_EMAIL ?? "";
    const fromName = process.env.SMTP_FROM_NAME ?? "PlayTrap";

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: normalizedEmail,
      subject,
      html,
      text,
    });
  } catch (err: unknown) {
    // Do NOT expose whether the email exists — return success regardless
    console.error("sendPasswordResetCustom internal error:", err);
  }

  return { ok: true };
});

// ── Public: send email verification using custom template ─────────────────────
export const sendEmailVerificationCustom = onCall(async (request) => {
  requireAppCheck(request);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email as string | undefined;
  if (!uid || !email) throw new HttpsError("unauthenticated", "Must be signed in.");

  const { locale } = (request.data ?? {}) as { locale?: string };
  const userLocale = (locale ?? "en").trim().toLowerCase();

  // Rate limit: 1 per uid per 60 s
  const db = getDb();
  const rlRef = db.collection("_rate_limits").doc(`email_verify_${uid}`);
  const rlSnap = await rlRef.get();
  if (rlSnap.exists) {
    const lastMs = (rlSnap.data()?.sentAtMs as number | undefined) ?? 0;
    if (Date.now() - lastMs < 60_000) {
      return { ok: true };
    }
  }
  await rlRef.set({ sentAtMs: Date.now() }, { merge: true });

  try {
    void autoSeedIfMissing("system_email_verification");
    const link = await getAuth().generateEmailVerificationLink(email);

    let displayName = "Player";
    try {
      const user = await getAuth().getUser(uid);
      displayName = user.displayName ?? email.split("@")[0] ?? "Player";
    } catch { /* non-fatal */ }

    const tmplData = await lookupTemplate("system_email_verification", userLocale);

    const subject = tmplData?.subject ?? "Verify your PlayTrap email address";
    const rawHtml = tmplData?.bodyHtml ?? DEFAULTS_EN.system_email_verification.bodyHtml;
    const rawText = tmplData?.bodyText ?? DEFAULTS_EN.system_email_verification.bodyText;

    const html = rawHtml
      .replace(/\{\{name\}\}/g, displayName)
      .replace(/\{\{verificationLink\}\}/g, link);
    const text = rawText
      .replace(/\{\{name\}\}/g, displayName)
      .replace(/\{\{verificationLink\}\}/g, link);

    const transporter = getMailer();
    const fromEmail = process.env.SMTP_FROM_EMAIL ?? "";
    const fromName = process.env.SMTP_FROM_NAME ?? "PlayTrap";

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject,
      html,
      text,
    });
  } catch (err: unknown) {
    console.error("sendEmailVerificationCustom internal error:", err);
  }

  return { ok: true };
});

// ── Admin: list templates ──────────────────────────────────────────────────────
export const adminListEmailTemplates = onCall(async (request) => {
  requireAdmin(request);

  const snap = await getDb().collection(COLL).orderBy("updatedAt", "desc").get();
  const templates = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name ?? "",
      subject: data.subject ?? "",
      type: data.type ?? "newsletter",
      locale: data.locale ?? "en",
      createdAt: (data.createdAt?.toMillis?.() ?? null) as number | null,
      updatedAt: (data.updatedAt?.toMillis?.() ?? null) as number | null,
    };
  });

  return { ok: true, templates };
});

// ── Admin: get single template ─────────────────────────────────────────────────
export const adminGetEmailTemplate = onCall(async (request) => {
  requireAdmin(request);

  const { id } = (request.data ?? {}) as { id?: string };
  if (!id) throw new HttpsError("invalid-argument", "id is required");

  const doc = await getDb().collection(COLL).doc(id).get();
  if (!doc.exists) throw new HttpsError("not-found", "Template not found");

  const data = doc.data()!;
  return {
    ok: true,
    template: {
      id: doc.id,
      name: data.name ?? "",
      subject: data.subject ?? "",
      bodyHtml: data.bodyHtml ?? "",
      bodyText: data.bodyText ?? "",
      type: data.type ?? "newsletter",
      locale: data.locale ?? "en",
      variables: data.variables ?? [],
      createdAt: (data.createdAt?.toMillis?.() ?? null) as number | null,
      updatedAt: (data.updatedAt?.toMillis?.() ?? null) as number | null,
    },
  };
});

// ── Admin: save (create or update) ────────────────────────────────────────────
export const adminSaveEmailTemplate = onCall(async (request) => {
  requireAdmin(request);

  const payload = (request.data ?? {}) as {
    id?: string; name?: string; subject?: string;
    bodyHtml?: string; bodyText?: string;
    type?: string; locale?: string; variables?: string[];
  };

  if (!payload.name?.trim()) throw new HttpsError("invalid-argument", "name is required");
  if (!payload.subject?.trim()) throw new HttpsError("invalid-argument", "subject is required");
  if (!payload.bodyHtml?.trim()) throw new HttpsError("invalid-argument", "bodyHtml is required");

  const now = FieldValue.serverTimestamp();
  const docData = {
    name: payload.name.trim(),
    subject: payload.subject.trim(),
    bodyHtml: payload.bodyHtml.trim(),
    bodyText: payload.bodyText?.trim() ?? "",
    type: payload.type ?? "newsletter",
    locale: payload.locale ?? "en",
    variables: payload.variables ?? [],
    updatedAt: now,
  };

  let docId: string;
  if (payload.id) {
    await getDb().collection(COLL).doc(payload.id).set(docData, { merge: true });
    docId = payload.id;
  } else {
    const ref = await getDb().collection(COLL).add({ ...docData, createdAt: now });
    docId = ref.id;
  }

  return { ok: true, id: docId };
});

// ── Admin: delete ──────────────────────────────────────────────────────────────
export const adminDeleteEmailTemplate = onCall(async (request) => {
  requireAdmin(request);
  const { id } = (request.data ?? {}) as { id?: string };
  if (!id) throw new HttpsError("invalid-argument", "id is required");
  await getDb().collection(COLL).doc(id).delete();
  return { ok: true };
});

// ── Admin: seed English system templates ───────────────────────────────────────
export const adminSeedSystemTemplates = onCall(async (request) => {
  requireAdmin(request);

  const { overwrite = false } = (request.data ?? {}) as { overwrite?: boolean };
  const db = getDb();
  const seeded: string[] = [];
  const skipped: string[] = [];

  for (const type of SYSTEM_TEMPLATE_TYPES) {
    const existing = await db.collection(COLL)
      .where("type", "==", type)
      .where("locale", "==", "en")
      .limit(1)
      .get();

    const label = `${type} (en)`;

    if (!existing.empty && !overwrite) {
      skipped.push(label);
      continue;
    }

    const def = DEFAULTS_EN[type];
    const docData = {
      name: `${SYSTEM_TEMPLATE_LABELS[type]} — English`,
      subject: def.subject,
      bodyHtml: def.bodyHtml,
      bodyText: def.bodyText,
      type,
      locale: "en",
      variables: def.variables,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    };

    if (!existing.empty && overwrite) {
      await db.collection(COLL).doc(existing.docs[0].id).set(docData, { merge: true });
    } else {
      await db.collection(COLL).add(docData);
    }
    seeded.push(label);
  }

  return { ok: true, seeded, skipped };
});

// ── Admin: AI translate an email template ──────────────────────────────────────
export const adminAiTranslateEmailTemplate = onCall(
  { timeoutSeconds: 120 },
  async (request) => {
    requireAdmin(request);

    const { id, targetLocales } = (request.data ?? {}) as {
      id?: string;
      targetLocales?: string[];
    };
    if (!id) throw new HttpsError("invalid-argument", "id is required");
    if (!targetLocales?.length) throw new HttpsError("invalid-argument", "targetLocales is required");

    const sourceDoc = await getDb().collection(COLL).doc(id).get();
    if (!sourceDoc.exists) throw new HttpsError("not-found", "Source template not found");

    const src = sourceDoc.data()!;
    if (src.locale !== "en") {
      throw new HttpsError("invalid-argument", "Source template must be in English (en)");
    }

    const apiKey = await getAnthropicApiKey();
    const db = getDb();
    const results: Array<{ locale: string; status: "created" | "updated" | "error"; error?: string }> = [];

    for (const locale of targetLocales) {
      if (locale === "en") continue;
      const localeName = LOCALE_NAMES[locale] ?? locale;

      try {
        const prompt = `You are a professional translator. Translate the following email template from English to ${localeName}.

Rules:
- Translate ONLY the visible text — do NOT translate HTML tags, CSS attributes, href values, or placeholders like {{name}}, {{resetLink}}, {{verificationLink}}, {{username}}.
- Keep all HTML structure, inline styles, and attributes exactly as-is.
- Keep all {{placeholder}} tokens exactly as-is (double curly braces, exact spelling).
- Produce natural, idiomatic ${localeName} — not literal word-for-word.
- Return a JSON object with exactly two keys: "subject" (string) and "bodyHtml" (string) and "bodyText" (string).
- Do not wrap in markdown code blocks.

Subject to translate:
${src.subject}

HTML body to translate:
${src.bodyHtml}

Plain text body to translate:
${src.bodyText ?? ""}`;

        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 8192,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (!resp.ok) throw new Error(`Anthropic API error ${resp.status}`);

        const json = await resp.json() as { content: Array<{ text: string }> };
        const raw = json.content[0]?.text?.trim() ?? "";

        // Strip markdown code fences if present
        const jsonStr = raw.startsWith("```") ? raw.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim() : raw;
        const translated = JSON.parse(jsonStr) as { subject: string; bodyHtml: string; bodyText?: string };

        // Look for existing translation to update
        const existingSnap = await db.collection(COLL)
          .where("type", "==", src.type)
          .where("locale", "==", locale)
          .limit(1)
          .get();

        const docData = {
          name: `${src.name?.replace(/ — English$/, "") ?? SYSTEM_TEMPLATE_LABELS[src.type as SystemTemplateType] ?? src.type} — ${localeName}`,
          subject: translated.subject,
          bodyHtml: translated.bodyHtml,
          bodyText: translated.bodyText ?? "",
          type: src.type,
          locale,
          variables: src.variables ?? [],
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (!existingSnap.empty) {
          await db.collection(COLL).doc(existingSnap.docs[0].id).set(docData, { merge: true });
          results.push({ locale, status: "updated" });
        } else {
          await db.collection(COLL).add({ ...docData, createdAt: FieldValue.serverTimestamp() });
          results.push({ locale, status: "created" });
        }
      } catch (err: unknown) {
        results.push({ locale, status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { ok: true, results };
  }
);

// ── Admin: send test email ─────────────────────────────────────────────────────
export const adminSendTestEmail = onCall(async (request) => {
  requireAdmin(request);

  const { templateId, toEmail } = (request.data ?? {}) as { templateId?: string; toEmail?: string };
  if (!templateId) throw new HttpsError("invalid-argument", "templateId is required");
  if (!toEmail) throw new HttpsError("invalid-argument", "toEmail is required");

  const doc = await getDb().collection(COLL).doc(templateId).get();
  if (!doc.exists) throw new HttpsError("not-found", "Template not found");

  const data = doc.data()!;
  const transporter = getMailer();
  const fromEmail = process.env.SMTP_FROM_EMAIL ?? "";
  const fromName = process.env.SMTP_FROM_NAME ?? "PlayTrap";

  const html = data.bodyHtml
    .replace(/\{\{name\}\}/g, "Test User")
    .replace(/\{\{username\}\}/g, "testuser")
    .replace(/\{\{resetLink\}\}/g, "https://playtrapnow.com")
    .replace(/\{\{verificationLink\}\}/g, "https://playtrapnow.com");

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: toEmail,
    subject: `[TEST] ${data.subject}`,
    html,
    text: data.bodyText || undefined,
  });

  return { ok: true };
});

// ── Admin: send newsletter ─────────────────────────────────────────────────────
export const adminSendNewsletter = onCall(
  { timeoutSeconds: 540 },
  async (request) => {
    requireAdmin(request);

    const { templateId, segment } = (request.data ?? {}) as {
      templateId?: string;
      segment?: "all" | "verified";
    };
    if (!templateId) throw new HttpsError("invalid-argument", "templateId is required");

    const doc = await getDb().collection(COLL).doc(templateId).get();
    if (!doc.exists) throw new HttpsError("not-found", "Template not found");

    const tmpl = doc.data()!;
    const transporter = getMailer();
    const fromEmail = process.env.SMTP_FROM_EMAIL ?? "";
    const fromName = process.env.SMTP_FROM_NAME ?? "PlayTrap";

    let query = getDb().collection("users").where("emailVerified", "==", true);
    if (segment === "all") {
      query = getDb().collection("users") as typeof query;
    }

    const usersSnap = await query.get();
    let sent = 0;
    let failed = 0;

    for (const userDoc of usersSnap.docs) {
      const u = userDoc.data();
      const email = u.email as string | undefined;
      if (!email) continue;

      const html = tmpl.bodyHtml
        .replace(/\{\{name\}\}/g, u.displayName ?? u.username ?? "Player")
        .replace(/\{\{username\}\}/g, u.username ?? "");

      try {
        await transporter.sendMail({
          from: `"${fromName}" <${fromEmail}>`,
          to: email,
          subject: tmpl.subject,
          html,
          text: tmpl.bodyText || undefined,
        });
        sent++;
      } catch {
        failed++;
      }
    }

    return { ok: true, sent, failed, total: usersSnap.size };
  }
);
