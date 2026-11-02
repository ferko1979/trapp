import { useState } from "react";
import type { User } from "firebase/auth";
import { logout } from "../auth";
import Sidebar, { type AdminSection } from "./Sidebar";
import DashboardHome from "./DashboardHome";
import UserManagementPanel from "./UserManagementPanel";
import GameSettingsPanel from "./GameSettingsPanel";
import TrapManagementPanel from "./TrapManagementPanel";
import TrapStatisticsPanel from "./TrapStatisticsPanel";
import UserLevelsPanel from "./UserLevelsPanel";
import GeneralSettingsPanel from "./GeneralSettingsPanel";
import AdminSupportTicketsPanel from "./AdminSupportTicketsPanel";
import AdminUserMessagesPanel from "./AdminUserMessagesPanel";
import TermsAndConditionsPanel from "./TermsAndConditionsPanel";
import AllyGroupsPanel from "./AllyGroupsPanel";
import TrapResultsPanel from "./TrapResultsPanel";
import ProfilePanel from "./ProfilePanel";
import AdminAuditLogPanel from "./AdminAuditLogPanel";
import PaymentOptionsPanel from "./PaymentOptionsPanel";
import PaymentPackagesPanel from "./PaymentPackagesPanel";
import DonationsPanel from "./DonationsPanel";
import ProgressionLevelsPanel from "./ProgressionLevelsPanel";
import UserDataPanel from "./UserDataPanel";
import RecalculatePointsPanel from "./RecalculatePointsPanel";
import AppTranslationsPanel from "./AppTranslationsPanel";
import AiSettingsPanel from "./AiSettingsPanel";
import PlayerMapPanel from "./PlayerMapPanel";
import TrapGeneratorPanel from "./TrapGeneratorPanel";
import EmailTemplatesPanel from "./EmailTemplatesPanel";
import NewsletterPanel from "./NewsletterPanel";
import AwardsPanel from "./AwardsPanel";

const SECTION_TITLES: Record<AdminSection, string> = {
  dashboard:           "Dashboard",
  users:               "User Management",
  user_data:           "User Data Management",
  progression_levels:  "Player Levels",
  levels:              "Membership Plans",
  payments:            "Payment Settings",
  packages:            "Payment Packages",
  donations:           "Donations",
  allies:              "Ally Groups",
  traps:               "Trap Management",
  game:                "Game Settings",
  general:             "General Settings",
  terms:               "Terms & Conditions",
  results:             "Results & Rankings",
  trap_gen_country:    "Trap Placer",
  trap_statistics:     "Trap Statistics",
  player_map:          "Live Player Map",
  support:             "Support Tickets",
  messages:            "User Messages",
  profile:             "Admin Profile",
  auditLog:            "Activity Log",
  recalculate_points:  "Recalculate Points",
  translations:        "App Translations",
  ai_settings:         "AI / API Keys",
  email_templates:     "Email Templates",
  newsletter:          "Newsletter",
  awards:              "Awards & Cards",
};

export default function Dashboard({ user }: { user: User }) {
  const [section, setSection] = useState<AdminSection>("dashboard");

  function renderContent() {
    switch (section) {
      case "users":              return <UserManagementPanel />;
      case "user_data":          return <UserDataPanel />;
      case "progression_levels": return <ProgressionLevelsPanel />;
      case "levels":             return <UserLevelsPanel />;
      case "payments":        return <PaymentOptionsPanel />;
      case "packages":        return <PaymentPackagesPanel />;
      case "donations":       return <DonationsPanel />;
      case "allies":          return <AllyGroupsPanel />;
      case "traps":             return <TrapManagementPanel />;
      case "trap_gen_country":  return <TrapGeneratorPanel />;
      case "game":            return <GameSettingsPanel />;
      case "general":         return <GeneralSettingsPanel />;
      case "terms":           return <TermsAndConditionsPanel />;
      case "results":         return <TrapResultsPanel />;
      case "trap_statistics": return <TrapStatisticsPanel />;
      case "player_map":      return <PlayerMapPanel />;
      case "support":         return <AdminSupportTicketsPanel />;
      case "messages":        return <AdminUserMessagesPanel />;
      case "profile":         return <ProfilePanel />;
      case "auditLog":            return <AdminAuditLogPanel />;
      case "recalculate_points": return <RecalculatePointsPanel />;
      case "translations":       return <AppTranslationsPanel />;
      case "ai_settings":        return <AiSettingsPanel />;
      case "email_templates":    return <EmailTemplatesPanel />;
      case "newsletter":         return <NewsletterPanel />;
      case "awards":             return <AwardsPanel />;
      case "dashboard":
      default:
        return <DashboardHome user={user} />;
    }
  }

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "#0b1120",
        color: "#e2e8f0",
      }}
    >
      <Sidebar
        current={section}
        onChange={setSection}
        onLogout={() => void logout()}
      />

      <main
        style={{
          flex: 1,
          padding: "28px 32px",
          minWidth: 0,
          overflowY: "auto",
        }}
      >
        {/* Page header */}
        <div
          style={{
            marginBottom: 28,
            paddingBottom: 20,
            borderBottom: "1px solid #1e3a5f",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.72rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#3b82f6",
                marginBottom: 4,
              }}
            >
              Trap Admin Console
            </div>
            <h1 style={{ margin: 0, fontSize: "1.5rem" }}>
              {SECTION_TITLES[section]}
            </h1>
          </div>
          <div
            style={{
              fontSize: "0.8125rem",
              color: "#64748b",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "#1e3a5f",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.9rem",
              }}
            >
              👤
            </span>
            {user.email ?? user.uid}
          </div>
        </div>

        {renderContent()}
      </main>
    </div>
  );
}
