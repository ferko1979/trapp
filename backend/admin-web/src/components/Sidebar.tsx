import { useState } from "react";

export type AdminSection =
  | "dashboard"
  | "users"
  | "user_data"
  | "levels"
  | "progression_levels"
  | "payments"
  | "packages"
  | "donations"
  | "allies"
  | "traps"
  | "trap_gen_country"
  | "game"
  | "general"
  | "terms"
  | "results"
  | "trap_statistics"
  | "player_map"
  | "support"
  | "messages"
  | "profile"
  | "auditLog"
  | "recalculate_points"
  | "translations"
  | "ai_settings"
  | "email_templates"
  | "newsletter"
  | "awards";

type NavItem = {
  key: AdminSection;
  label: string;
  icon: string;
};

type NavGroup = {
  groupKey: string;
  label: string;
  icon: string;
  items: NavItem[];
};

type TopLevelItem = {
  type: "item";
  key: AdminSection;
  label: string;
  icon: string;
};

type TopLevelGroup = {
  type: "group";
} & NavGroup;

const NAV: (TopLevelItem | TopLevelGroup)[] = [
  {
    type: "item",
    key: "dashboard",
    label: "Dashboard",
    icon: "⬛",
  },
  {
    type: "group",
    groupKey: "user_mgmt",
    label: "User Management",
    icon: "👥",
    items: [
      { key: "users",              label: "Users",              icon: "👤" },
      { key: "user_data",          label: "User Data",          icon: "🗑️" },
      { key: "progression_levels", label: "Player Levels",      icon: "🪖" },
      { key: "levels",             label: "Membership Plans",   icon: "💎" },
      { key: "payments",           label: "Payment Settings",   icon: "💳" },
      { key: "packages",           label: "Payment Packages",   icon: "📦" },
      { key: "donations",          label: "Donations",          icon: "🎁" },
    ],
  },
  {
    type: "group",
    groupKey: "game_options",
    label: "Game Options",
    icon: "🎮",
    items: [
      { key: "allies",           label: "Ally Groups",      icon: "🤝" },
      { key: "traps",           label: "Trap Management",  icon: "🪤" },
      { key: "trap_gen_country", label: "Trap Placer",     icon: "🎯" },
      { key: "awards",          label: "Awards & Cards",   icon: "🏅" },
      { key: "game",            label: "Game Settings",       icon: "⚙️" },
      { key: "general",        label: "General Settings",     icon: "🔧" },
      { key: "terms",          label: "Terms & Conditions",   icon: "📋" },
    ],
  },
  {
    type: "group",
    groupKey: "statistics",
    label: "Statistics",
    icon: "📊",
    items: [
      { key: "results",         label: "Results & Rankings", icon: "🏆" },
      { key: "trap_statistics", label: "Trap Statistics",    icon: "📈" },
      { key: "player_map",      label: "Live Player Map",    icon: "🗺️" },
    ],
  },
  {
    type: "group",
    groupKey: "comms",
    label: "Messages & Support",
    icon: "💬",
    items: [
      { key: "support",         label: "Support Tickets",  icon: "🎫" },
      { key: "messages",        label: "User Messages",    icon: "✉️" },
      { key: "email_templates", label: "Email Templates",  icon: "📧" },
      { key: "newsletter",      label: "Newsletter",       icon: "📰" },
    ],
  },
  {
    type: "group",
    groupKey: "admin_tools",
    label: "Admin Tools",
    icon: "🛡️",
    items: [
      { key: "profile",            label: "Admin Profile",       icon: "👤" },
      { key: "auditLog",           label: "Activity Log",        icon: "📋" },
      { key: "recalculate_points", label: "Recalculate Points",  icon: "🔄" },
      { key: "translations",       label: "App Translations",    icon: "🌍" },
      { key: "ai_settings",        label: "AI / API Keys",       icon: "🤖" },
    ],
  },
];

// All groups start expanded
function defaultOpenGroups(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const entry of NAV) {
    if (entry.type === "group") out[entry.groupKey] = true;
  }
  return out;
}

function isActive(entry: TopLevelItem | TopLevelGroup, current: AdminSection): boolean {
  if (entry.type === "item") return entry.key === current;
  return entry.items.some((i) => i.key === current);
}

export default function Sidebar({
  current,
  onChange,
  onLogout,
}: {
  current: AdminSection;
  onChange: (section: AdminSection) => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(defaultOpenGroups);

  function toggle(key: string) {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const sidebarBg   = "#0d1827";
  const borderColor = "#1a2e45";
  const activeBg    = "#1d4ed8";
  const hoverBg     = "#162033";
  const groupLabelColor = "#64748b";

  return (
    <aside
      style={{
        width: 230,
        minWidth: 230,
        background: sidebarBg,
        borderRight: `1px solid ${borderColor}`,
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        userSelect: "none",
      }}
    >
      {/* Logo / brand */}
      <div
        style={{
          padding: "16px 16px 14px",
          borderBottom: `1px solid ${borderColor}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <img
            src="/logo.png"
            alt="Trapp logo"
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              objectFit: "contain",
              flexShrink: 0,
            }}
          />
          <div>
            <div
              style={{
                fontSize: "1.05rem",
                fontWeight: 800,
                color: "#f8fafc",
                letterSpacing: "-0.3px",
                lineHeight: 1.2,
              }}
            >
              Trapp
            </div>
            <div
              style={{
                fontSize: "0.65rem",
                fontWeight: 600,
                color: "#3b82f6",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Admin Console
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 10px", overflowY: "auto" }}>
        {NAV.map((entry) => {
          if (entry.type === "item") {
            const active = current === entry.key;
            return (
              <NavButton
                key={entry.key}
                label={entry.label}
                icon={entry.icon}
                active={active}
                indent={false}
                activeBg={activeBg}
                hoverBg={hoverBg}
                onClick={() => onChange(entry.key)}
              />
            );
          }

          // Group
          const groupActive = isActive(entry, current);
          const isOpen = open[entry.groupKey] ?? true;

          return (
            <div key={entry.groupKey} style={{ marginBottom: 2 }}>
              {/* Group header (clickable to collapse) */}
              <button
                onClick={() => toggle(entry.groupKey)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px 7px",
                  background: "transparent",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  color: groupActive ? "#e2e8f0" : groupLabelColor,
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color =
                    groupActive ? "#e2e8f0" : groupLabelColor;
                }}
              >
                <span style={{ fontSize: "0.95rem" }}>{entry.icon}</span>
                <span style={{ flex: 1, textAlign: "left" }}>{entry.label}</span>
                <span
                  style={{
                    fontSize: "0.7rem",
                    transition: "transform 0.2s",
                    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                    opacity: 0.6,
                  }}
                >
                  ▼
                </span>
              </button>

              {/* Sub-items */}
              {isOpen && (
                <div
                  style={{
                    marginLeft: 10,
                    paddingLeft: 8,
                    borderLeft: `1px solid ${borderColor}`,
                    marginBottom: 6,
                  }}
                >
                  {entry.items.map((item) => {
                    const active = current === item.key;
                    return (
                      <NavButton
                        key={item.key}
                        label={item.label}
                        icon={item.icon}
                        active={active}
                        indent={true}
                        activeBg={activeBg}
                        hoverBg={hoverBg}
                        onClick={() => onChange(item.key)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Logout pinned to bottom */}
      <div
        style={{
          padding: "12px 10px 18px",
          borderTop: `1px solid ${borderColor}`,
        }}
      >
        <button
          onClick={onLogout}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            background: "rgba(153,27,27,0.18)",
            border: "1px solid rgba(153,27,27,0.4)",
            borderRadius: 9,
            color: "#fca5a5",
            fontWeight: 600,
            fontSize: "0.875rem",
            cursor: "pointer",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#7f1d1d";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(153,27,27,0.18)";
          }}
        >
          <span>🚪</span>
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}

function NavButton({
  label,
  icon,
  active,
  indent,
  activeBg,
  hoverBg,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  indent: boolean;
  activeBg: string;
  hoverBg: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: indent ? "8px 10px" : "9px 10px",
        background: active ? activeBg : hovered ? hoverBg : "transparent",
        border: "none",
        borderRadius: 8,
        color: active ? "#fff" : hovered ? "#e2e8f0" : "#94a3b8",
        fontWeight: active ? 600 : 400,
        fontSize: indent ? "0.875rem" : "0.9rem",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.12s, color 0.12s",
        marginBottom: 1,
        boxShadow: active ? "0 2px 8px rgba(29,78,216,0.35)" : "none",
      }}
    >
      <span style={{ fontSize: "0.9rem", opacity: active ? 1 : 0.7 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
