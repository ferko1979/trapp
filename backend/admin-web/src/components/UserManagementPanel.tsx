import { httpsCallable } from "firebase/functions";
import { useEffect, useMemo, useState } from "react";
import { functions } from "../firebase";

type TrapCountsByType = Record<string, number>;
type AgeGroup = "minor" | "adult";
type Gender = "male" | "female" | "other" | "prefer_not_to_say";

type UserItem = {
  uid: string;
  username?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  role?: string | null;
  status?: string | null;
  levelId?: string | null;

  birthDate?: string | null;
  age?: number | null;
  ageGroup?: AgeGroup | null;
  gender?: Gender | null;

  acceptedTerms?: boolean | null;
  acceptedTermsAtEpochMs?: number | null;

  emailVerified?: boolean | null;
  emailVerifiedAtEpochMs?: number | null;
  verificationTriggeredAtEpochMs?: number | null;
  verificationTriggeredIp?: string | null;

  globalRank?: number | null;
  friendsRank?: number | null;
  alliesRank?: number | null;

  activeTrapCount?: number | null;
  placedTrapCountTotal?: number | null;
  placedTrapCountsByType?: TrapCountsByType | null;

  bagSize?: number | null;
  bagAvailableTotal?: number | null;
  bagAvailableByType?: TrapCountsByType | null;
};

type LevelItem = {
  id: string;
  name?: string | null;
  active?: boolean;
};

type UserSearchResponse = {
  ok?: boolean;
  items?: UserItem[];
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
};

type LevelsResponse = {
  items?: LevelItem[];
};

type EditableUserDraft = {
  displayName: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: Gender;
  role: string;
  status: string;
  levelId: string;

  acceptedTerms: boolean;
  acceptedTermsAt: string;

  emailVerified: boolean;
  emailVerifiedAt: string;

  newPassword: string;
};

function renderCountsMap(map?: TrapCountsByType | null) {
  if (!map || Object.keys(map).length === 0) {
    return "-";
  }

  return Object.entries(map)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");
}

function formatEpochMs(value?: number | null) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "-";
  }
}

function epochMsToDatetimeLocal(value?: number | null): string {
  if (!value) return "";
  try {
    const d = new Date(value);
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch {
    return "";
  }
}

function datetimeLocalToEpochMs(value?: string): number | null {
  if (!value) return null;
  const d = new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function calculateAgeFromBirthDate(birthDate?: string | null): number | null {
  if (!birthDate) return null;

  const parts = birthDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) {
    return null;
  }

  const [year, month, day] = parts;
  const today = new Date();

  let age = today.getFullYear() - year;
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();

  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }

  if (!Number.isFinite(age) || age < 0 || age > 130) {
    return null;
  }

  return age;
}

function deriveAgeGroup(age?: number | null): AgeGroup | null {
  if (typeof age !== "number" || !Number.isFinite(age)) return null;
  return age >= 18 ? "adult" : "minor";
}

function getResolvedAge(user: UserItem): number | null {
  if (user.birthDate) {
    return calculateAgeFromBirthDate(user.birthDate);
  }
  return typeof user.age === "number" && Number.isFinite(user.age) ? user.age : null;
}

function getResolvedAgeGroup(user: UserItem): AgeGroup | null {
  const resolvedAge = getResolvedAge(user);
  if (resolvedAge !== null) {
    return deriveAgeGroup(resolvedAge);
  }

  if (user.ageGroup === "adult" || user.ageGroup === "minor") {
    return user.ageGroup;
  }

  return null;
}

function fieldLabelStyle(): React.CSSProperties {
  return {
    fontSize: 12,
    opacity: 0.9,
    marginBottom: 4,
    display: "block",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #5F7491",
    background: "#F4F7FB",
    color: "#0D1F33",
    boxSizing: "border-box",
  };
}

function readonlyFieldStyle(): React.CSSProperties {
  return {
    ...inputStyle(),
    display: "flex",
    alignItems: "center",
    minHeight: 42,
    opacity: 0.9,
  };
}

function sectionCardStyle(): React.CSSProperties {
  return {
    background: "#EEF2F7",
    padding: 20,
    borderRadius: 12,
    border: "1px solid #DCE4EE",
  };
}

function helper(text: string) {
  return <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{text}</div>;
}

function buildDraft(user: UserItem): EditableUserDraft {
  return {
    displayName: user.displayName ?? "",
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    birthDate: user.birthDate ?? "",
    gender: user.gender ?? "prefer_not_to_say",
    role: user.role ?? "user",
    status: user.status ?? "active",
    levelId: user.levelId ?? "free",

    acceptedTerms: user.acceptedTerms === true,
    acceptedTermsAt: epochMsToDatetimeLocal(user.acceptedTermsAtEpochMs),

    emailVerified: user.emailVerified === true,
    emailVerifiedAt: epochMsToDatetimeLocal(user.emailVerifiedAtEpochMs),

    newPassword: "",
  };
}

export default function UserManagementPanel() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [levels, setLevels] = useState<LevelItem[]>([]);
  const [result, setResult] = useState("");

  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditableUserDraft | null>(null);
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newBirthDate, setNewBirthDate] = useState("");
  const [newGender, setNewGender] = useState<Gender>("prefer_not_to_say");
  const [newAcceptedTerms, setNewAcceptedTerms] = useState(false);
  const [newLevelId, setNewLevelId] = useState("free");
  const [newRole, setNewRole] = useState("user");
  const [newStatus, setNewStatus] = useState("active");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [pageSize, setPageSize] = useState(25);
  const [pageInput, setPageInput] = useState("1");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const newComputedAge = useMemo(
    () => calculateAgeFromBirthDate(newBirthDate),
    [newBirthDate]
  );

  const newComputedAgeGroup = useMemo(
    () => deriveAgeGroup(newComputedAge),
    [newComputedAge]
  );

  const editComputedAge = useMemo(
    () => calculateAgeFromBirthDate(editDraft?.birthDate ?? ""),
    [editDraft?.birthDate]
  );

  const editComputedAgeGroup = useMemo(
    () => deriveAgeGroup(editComputedAge),
    [editComputedAge]
  );

  async function loadLevels() {
    const fn = httpsCallable<unknown, LevelsResponse>(functions, "adminListLevels");
    const res = await fn();

    const availableLevels = (res.data.items ?? []).filter(
      (level) => level.active !== false
    );

    setLevels(availableLevels);

    if (
      availableLevels.length > 0 &&
      !availableLevels.some((level) => level.id === newLevelId)
    ) {
      setNewLevelId(availableLevels[0].id);
    }

    if (
      levelFilter !== "all" &&
      !availableLevels.some((level) => level.id === levelFilter)
    ) {
      setLevelFilter("all");
    }
  }

  async function loadUsers(targetPage = 1) {
    const fn = httpsCallable<
      {
        page: number;
        pageSize: number;
        search: string;
        role: string;
        status: string;
        levelId: string;
      },
      UserSearchResponse
    >(functions, "adminSearchUsers");

    const res = await fn({
      page: targetPage,
      pageSize,
      search: search.trim(),
      role: roleFilter === "all" ? "" : roleFilter,
      status: statusFilter === "all" ? "" : statusFilter,
      levelId: levelFilter === "all" ? "" : levelFilter,
    });

    const data = res.data;
    const nextPage = data.page ?? 1;

    setUsers(data.items ?? []);
    setPage(nextPage);
    setPageInput(String(nextPage));
    setTotalPages(data.totalPages ?? 1);
    setTotal(data.total ?? 0);
  }

  useEffect(() => {
    void loadLevels();
  }, []);

  useEffect(() => {
    void loadUsers(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, roleFilter, statusFilter, levelFilter]);

  async function runSearch() {
    await loadUsers(1);
  }

  async function createUser() {
    if (!newEmail.trim()) {
      setResult("Email is required.");
      return;
    }

    if (!newUsername.trim()) {
      setResult("Username is required.");
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      setResult("Password is required and must be at least 6 characters.");
      return;
    }

    if (!newBirthDate) {
      setResult("Birthdate is required.");
      return;
    }

    if (!newAcceptedTerms) {
      setResult("Terms and conditions must be accepted before creating the user.");
      return;
    }

    try {
      const fn = httpsCallable(functions, "adminCreateUser");
      const res = await fn({
        email: newEmail.trim(),
        username: newUsername.trim(),
        password: newPassword,
        displayName: newDisplayName.trim(),
        firstName: newFirstName.trim(),
        lastName: newLastName.trim(),
        birthDate: newBirthDate,
        gender: newGender,
        acceptedTerms: newAcceptedTerms,
        acceptedTermsVersion: "v1",
        levelId: newLevelId,
        role: newRole,
        status: newStatus,
        sendVerificationEmail: true,
      });

      setResult(JSON.stringify(res.data, null, 2));

      setNewEmail("");
      setNewUsername("");
      setNewPassword("");
      setNewDisplayName("");
      setNewFirstName("");
      setNewLastName("");
      setNewBirthDate("");
      setNewGender("prefer_not_to_say");
      setNewAcceptedTerms(false);
      setNewLevelId(levels[0]?.id ?? "free");
      setNewRole("user");
      setNewStatus("active");

      await loadLevels();
      await loadUsers(1);
    } catch (error: any) {
      setResult(
        JSON.stringify(
          {
            message: error?.message ?? "Unknown error",
            code: error?.code ?? null,
            details: error?.details ?? null,
          },
          null,
          2
        )
      );
    }
  }

  async function setStatus(uid: string, status: "active" | "inactive" | "suspended") {
    const fn = httpsCallable(functions, "adminUpdateUserStatus");
    const res = await fn({ uid, status });
    setResult(JSON.stringify(res.data, null, 2));
    await loadUsers(page);
  }

  async function setLevel(uid: string, levelId: string) {
    const fn = httpsCallable(functions, "adminSetUserLevel");
    const res = await fn({ uid, levelId });
    setResult(JSON.stringify(res.data, null, 2));
    await loadLevels();
    await loadUsers(page);
  }

  async function toggleAdmin(uid: string, admin: boolean) {
    const fn = httpsCallable(functions, "setUserAdmin");
    const res = await fn({ uid, admin });
    setResult(JSON.stringify(res.data, null, 2));
    await loadUsers(page);
  }

  async function deleteUser(uid: string) {
    const fn = httpsCallable(functions, "adminDeleteUser");
    const res = await fn({ uid });
    setResult(JSON.stringify(res.data, null, 2));
    await loadUsers(page);
  }

  async function resetUserAvailability(uid: string) {
    const fn = httpsCallable(functions, "adminResetUserTrapAvailability");
    const res = await fn({ uid });
    setResult(JSON.stringify(res.data, null, 2));
    await loadUsers(page);
  }

  async function syncEmailVerification(uid: string) {
    const fn = httpsCallable(functions, "adminSyncEmailVerificationStatus");
    const res = await fn({ uid });
    setResult(JSON.stringify(res.data, null, 2));
    await loadUsers(page);
  }

  async function backfillAuthUsers() {
    setBackfilling(true);
    try {
      const fn = httpsCallable(functions, "adminBackfillAuthUsersToFirestore");
      const res = await fn({});
      setResult(JSON.stringify(res.data, null, 2));
      await loadUsers(1);
    } catch (error: any) {
      setResult(
        JSON.stringify(
          {
            message: error?.message ?? "Unknown error",
            code: error?.code ?? null,
            details: error?.details ?? null,
          },
          null,
          2
        )
      );
    } finally {
      setBackfilling(false);
    }
  }

  function startEditing(user: UserItem) {
    setEditingUid(user.uid);
    setEditDraft(buildDraft(user));
  }

  function cancelEditing() {
    setEditingUid(null);
    setEditDraft(null);
  }

  async function saveEditedUser(uid: string) {
    if (!editDraft) return;

    if (!editDraft.birthDate) {
      setResult("Birthdate is required when editing a user.");
      return;
    }

    if (editDraft.newPassword && editDraft.newPassword.length < 6) {
      setResult("New password must be at least 6 characters.");
      return;
    }

    setSavingUid(uid);
    try {
      const updateProfileFn = httpsCallable(functions, "adminUpdateUserProfile");

      const profilePayload = {
        uid,
        displayName: editDraft.displayName.trim(),
        firstName: editDraft.firstName.trim(),
        lastName: editDraft.lastName.trim(),
        birthDate: editDraft.birthDate,
        gender: editDraft.gender,
        role: editDraft.role,
        status: editDraft.status,
        levelId: editDraft.levelId,

        acceptedTerms: editDraft.acceptedTerms,
        acceptedTermsAtEpochMs: datetimeLocalToEpochMs(editDraft.acceptedTermsAt),

        emailVerified: editDraft.emailVerified,
        emailVerifiedAtEpochMs: datetimeLocalToEpochMs(editDraft.emailVerifiedAt),
      };

      const profileRes = await updateProfileFn(profilePayload);

      let passwordRes: unknown = null;
      if (editDraft.newPassword.trim()) {
        const setPasswordFn = httpsCallable(functions, "adminSetUserPassword");
        const pwRes = await setPasswordFn({
          uid,
          newPassword: editDraft.newPassword.trim(),
        });
        passwordRes = pwRes.data;
      }

      setResult(
        JSON.stringify(
          {
            profile: profileRes.data,
            password: passwordRes,
          },
          null,
          2
        )
      );

      setEditingUid(null);
      setEditDraft(null);
      await loadLevels();
      await loadUsers(page);
    } catch (error: any) {
      setResult(
        JSON.stringify(
          {
            message: error?.message ?? "Unknown error",
            code: error?.code ?? null,
            details: error?.details ?? null,
          },
          null,
          2
        )
      );
    } finally {
      setSavingUid(null);
    }
  }

  async function goToPage() {
    const parsed = Number(pageInput);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setPageInput(String(page));
      return;
    }
    await loadUsers(Math.min(parsed, totalPages));
  }

  return (
    <section style={{ display: "grid", gap: 20 }}>
      <div style={sectionCardStyle()}>
        <h2 style={{ marginTop: 0 }}>Create User</h2>

        <div style={{ display: "grid", gap: 18, maxWidth: 760 }}>
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            }}
          >
            <div>
              <label htmlFor="new-email" style={fieldLabelStyle()}>
                Email *
              </label>
              <input
                id="new-email"
                style={inputStyle()}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Email"
              />
              {helper("Required. Used for login and verification.")}
            </div>

            <div>
              <label htmlFor="new-username" style={fieldLabelStyle()}>
                Username *
              </label>
              <input
                id="new-username"
                style={inputStyle()}
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Username"
              />
              {helper("Required. Must be unique.")}
            </div>

            <div>
              <label htmlFor="new-password" style={fieldLabelStyle()}>
                Password *
              </label>
              <input
                id="new-password"
                style={inputStyle()}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Password"
                type="password"
              />
              {helper("Required. Minimum 6 characters.")}
            </div>

            <div>
              <label htmlFor="new-display-name" style={fieldLabelStyle()}>
                Display name
              </label>
              <input
                id="new-display-name"
                style={inputStyle()}
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="Display name"
              />
              {helper("Main visible name used across the app.")}
            </div>

            <div>
              <label htmlFor="new-first-name" style={fieldLabelStyle()}>
                First name
              </label>
              <input
                id="new-first-name"
                style={inputStyle()}
                value={newFirstName}
                onChange={(e) => setNewFirstName(e.target.value)}
                placeholder="First name"
              />
            </div>

            <div>
              <label htmlFor="new-last-name" style={fieldLabelStyle()}>
                Last name
              </label>
              <input
                id="new-last-name"
                style={inputStyle()}
                value={newLastName}
                onChange={(e) => setNewLastName(e.target.value)}
                placeholder="Last name"
              />
            </div>
          </div>

          <div
            style={{
              background: "#F4F7FB",
              border: "1px solid #DCE4EE",
              borderRadius: 10,
              padding: 16,
              display: "grid",
              gap: 14,
            }}
          >
            <h3 style={{ margin: 0 }}>User Details</h3>

            <div
              style={{
                display: "grid",
                gap: 14,
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              }}
            >
              <div>
                <label htmlFor="new-birth-date" style={fieldLabelStyle()}>
                  Birthdate *
                </label>
                <input
                  id="new-birth-date"
                  style={inputStyle()}
                  value={newBirthDate}
                  onChange={(e) => setNewBirthDate(e.target.value)}
                  type="date"
                />
                {helper("Editable field. Age and age group are calculated automatically from this.")}
              </div>

              <div>
                <label htmlFor="new-gender" style={fieldLabelStyle()}>
                  Gender
                </label>
                <select
                  id="new-gender"
                  style={inputStyle()}
                  value={newGender}
                  onChange={(e) => setNewGender(e.target.value as Gender)}
                >
                  <option value="male">male</option>
                  <option value="female">female</option>
                  <option value="other">other</option>
                  <option value="prefer_not_to_say">prefer_not_to_say</option>
                </select>
              </div>

              <div>
                <label style={fieldLabelStyle()}>Age (calculated automatically)</label>
                <div style={readonlyFieldStyle()}>{newComputedAge ?? "-"}</div>
              </div>

              <div>
                <label style={fieldLabelStyle()}>Age group (calculated automatically)</label>
                <div style={readonlyFieldStyle()}>{newComputedAgeGroup ?? "-"}</div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            }}
          >
            <div>
              <label htmlFor="new-user-level" style={fieldLabelStyle()}>
                Initial level
              </label>
              <select
                id="new-user-level"
                style={inputStyle()}
                value={newLevelId}
                onChange={(e) => setNewLevelId(e.target.value)}
              >
                {levels.length > 0 ? (
                  levels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.name ?? level.id}
                    </option>
                  ))
                ) : (
                  <option value="free">free</option>
                )}
              </select>
              {helper("Assign one of the currently available levels immediately.")}
            </div>

            <div>
              <label htmlFor="new-user-role" style={fieldLabelStyle()}>
                Initial role
              </label>
              <select
                id="new-user-role"
                style={inputStyle()}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>

            <div>
              <label htmlFor="new-user-status" style={fieldLabelStyle()}>
                Initial status
              </label>
              <select
                id="new-user-status"
                style={inputStyle()}
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="suspended">suspended</option>
              </select>
            </div>
          </div>

          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              background: "#F4F7FB",
              padding: 12,
              borderRadius: 8,
              border: "1px solid #DCE4EE",
            }}
          >
            <input
              type="checkbox"
              checked={newAcceptedTerms}
              onChange={(e) => setNewAcceptedTerms(e.target.checked)}
            />
            <span>I confirm that the user accepted the Terms and Conditions.</span>
          </label>

          <div>
            <button onClick={() => void createUser()}>Create user</button>
          </div>
        </div>
      </div>

      <div style={sectionCardStyle()}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0 }}>User Management</h2>

          <button onClick={() => void backfillAuthUsers()} disabled={backfilling}>
            {backfilling ? "Backfilling..." : "Backfill missing Auth users"}
          </button>
        </div>

        <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <input
              style={inputStyle()}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, username, or email"
            />
            {helper("Searches display name, first name, last name, username, and email.")}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div>
              <label htmlFor="filter-role" style={fieldLabelStyle()}>
                Role
              </label>
              <select
                id="filter-role"
                style={inputStyle()}
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="all">all</option>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>

            <div>
              <label htmlFor="filter-status" style={fieldLabelStyle()}>
                Status
              </label>
              <select
                id="filter-status"
                style={inputStyle()}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">all</option>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="suspended">suspended</option>
              </select>
            </div>

            <div>
              <label htmlFor="filter-level" style={fieldLabelStyle()}>
                Level
              </label>
              <select
                id="filter-level"
                style={inputStyle()}
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
              >
                <option value="all">all</option>
                {levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name ?? level.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="page-size" style={fieldLabelStyle()}>
                Show
              </label>
              <select
                id="page-size"
                style={inputStyle()}
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
                <option value={500}>500</option>
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
              <button onClick={() => void runSearch()}>Search</button>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 12, fontSize: 14, opacity: 0.9 }}>
          Total matching users: {total}
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {users.map((u) => {
            const resolvedAge = getResolvedAge(u);
            const resolvedAgeGroup = getResolvedAgeGroup(u);
            const isEditing = editingUid === u.uid && !!editDraft;

            return (
              <div
                key={u.uid}
                style={{
                  padding: 14,
                  border: "1px solid #DCE4EE",
                  borderRadius: 10,
                  display: "grid",
                  gap: 10,
                  background: "#F4F7FB",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <strong>{u.displayName ?? "Anonymous"}</strong>
                    <div style={{ marginTop: 4, opacity: 0.85 }}>
                      Username: {u.username ? `@${u.username}` : "-"}
                    </div>
                  </div>

                  <div style={{ textAlign: "right", opacity: 0.9 }}>
                    <div>Role: {u.role ?? "user"}</div>
                    <div>Status: {u.status ?? "active"}</div>
                    <div>Level: {u.levelId ?? "free"}</div>
                  </div>
                </div>

                <div>
                  Name: {u.firstName ?? "-"} {u.lastName ?? ""}
                </div>

                <div>Email: {u.email ?? u.uid}</div>

                <div
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid #DCE4EE",
                    background: "#F4F7FB",
                  }}
                >
                  <strong>Profile details</strong>
                  <div style={{ marginTop: 6 }}>
                    Birthdate: {u.birthDate ?? "-"} | Age: {resolvedAge ?? "-"} | Age group:{" "}
                    {resolvedAgeGroup ?? "-"} | Gender: {u.gender ?? "-"}
                  </div>
                </div>

                {isEditing && editDraft ? (
                  <div
                    style={{
                      display: "grid",
                      gap: 14,
                      border: "1px solid #DCE4EE",
                      borderRadius: 10,
                      padding: 14,
                      background: "#F4F7FB",
                    }}
                  >
                    <strong>Edit user details</strong>

                    <div
                      style={{
                        display: "grid",
                        gap: 12,
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      }}
                    >
                      <div>
                        <label style={fieldLabelStyle()}>Display name</label>
                        <input
                          style={inputStyle()}
                          value={editDraft.displayName}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, displayName: e.target.value })
                          }
                        />
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>First name</label>
                        <input
                          style={inputStyle()}
                          value={editDraft.firstName}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, firstName: e.target.value })
                          }
                        />
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>Last name</label>
                        <input
                          style={inputStyle()}
                          value={editDraft.lastName}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, lastName: e.target.value })
                          }
                        />
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>Birthdate (editable)</label>
                        <input
                          style={inputStyle()}
                          type="date"
                          value={editDraft.birthDate}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, birthDate: e.target.value })
                          }
                        />
                        {helper("Change birthdate to update age and age group.")}
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>Gender</label>
                        <select
                          style={inputStyle()}
                          value={editDraft.gender}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              gender: e.target.value as Gender,
                            })
                          }
                        >
                          <option value="male">male</option>
                          <option value="female">female</option>
                          <option value="other">other</option>
                          <option value="prefer_not_to_say">prefer_not_to_say</option>
                        </select>
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>Role</label>
                        <select
                          style={inputStyle()}
                          value={editDraft.role}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, role: e.target.value })
                          }
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                        </select>
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>Status</label>
                        <select
                          style={inputStyle()}
                          value={editDraft.status}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, status: e.target.value })
                          }
                        >
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                          <option value="suspended">suspended</option>
                        </select>
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>Level</label>
                        <select
                          style={inputStyle()}
                          value={editDraft.levelId}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, levelId: e.target.value })
                          }
                        >
                          {levels.length > 0 ? (
                            levels.map((level) => (
                              <option key={level.id} value={level.id}>
                                {level.name ?? level.id}
                              </option>
                            ))
                          ) : (
                            <option value="free">free</option>
                          )}
                        </select>
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>Age (calculated automatically)</label>
                        <div style={readonlyFieldStyle()}>{editComputedAge ?? "-"}</div>
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>
                          Age group (calculated automatically)
                        </label>
                        <div style={readonlyFieldStyle()}>{editComputedAgeGroup ?? "-"}</div>
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>Accepted Terms</label>
                        <label
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            background: "#F4F7FB",
                            border: "1px solid #5F7491",
                            borderRadius: 8,
                            padding: "10px 12px",
                            minHeight: 42,
                            boxSizing: "border-box",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={editDraft.acceptedTerms}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                acceptedTerms: e.target.checked,
                              })
                            }
                          />
                          <span>User accepted Terms & Conditions</span>
                        </label>
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>Accepted Terms at</label>
                        <input
                          style={inputStyle()}
                          type="datetime-local"
                          value={editDraft.acceptedTermsAt}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              acceptedTermsAt: e.target.value,
                            })
                          }
                        />
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>Email verified</label>
                        <label
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            background: "#F4F7FB",
                            border: "1px solid #5F7491",
                            borderRadius: 8,
                            padding: "10px 12px",
                            minHeight: 42,
                            boxSizing: "border-box",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={editDraft.emailVerified}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                emailVerified: e.target.checked,
                              })
                            }
                          />
                          <span>Approved verified email status</span>
                        </label>
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>Email verified at</label>
                        <input
                          style={inputStyle()}
                          type="datetime-local"
                          value={editDraft.emailVerifiedAt}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              emailVerifiedAt: e.target.value,
                            })
                          }
                        />
                      </div>

                      <div>
                        <label style={fieldLabelStyle()}>Set new password</label>
                        <input
                          style={inputStyle()}
                          type="password"
                          value={editDraft.newPassword}
                          placeholder="Leave empty to keep unchanged"
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              newPassword: e.target.value,
                            })
                          }
                        />
                        {helper("Optional. If entered, this replaces the current password.")}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        onClick={() => void saveEditedUser(u.uid)}
                        disabled={savingUid === u.uid}
                      >
                        {savingUid === u.uid ? "Saving..." : "Save changes"}
                      </button>
                      <button onClick={cancelEditing} disabled={savingUid === u.uid}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {u.emailVerified ? (
                    <span style={{ color: "#178A55", fontWeight: 600 }}>
                      ✅ Email verified
                    </span>
                  ) : u.verificationTriggeredAtEpochMs ? (
                    <span style={{ color: "#8A5A0B", fontWeight: 600 }}>
                      📧 Verification email sent — awaiting user action
                    </span>
                  ) : (
                    <span style={{ color: "#C8283B", fontWeight: 600 }}>
                      ⚠️ Verification not triggered
                    </span>
                  )}
                </div>

                <div>
                  Verified at: {formatEpochMs(u.emailVerifiedAtEpochMs)} | Email sent at:{" "}
                  {formatEpochMs(u.verificationTriggeredAtEpochMs)} | Trigger IP:{" "}
                  {u.verificationTriggeredIp ?? "-"}
                </div>

                <div>
                  Accepted T&C: {u.acceptedTerms ? "yes" : "no"} | Accepted at:{" "}
                  {formatEpochMs(u.acceptedTermsAtEpochMs)}
                </div>

                <div>
                  Rank — global: {u.globalRank ?? "-"} | friends: {u.friendsRank ?? "-"} |
                  allies: {u.alliesRank ?? "-"}
                </div>

                <div>
                  Placed traps — active now: {u.activeTrapCount ?? 0} | total placed:{" "}
                  {u.placedTrapCountTotal ?? 0}
                </div>

                <div>Placed by type: {renderCountsMap(u.placedTrapCountsByType)}</div>

                <div>
                  Bag — size: {u.bagSize ?? "-"} | available now: {u.bagAvailableTotal ?? "-"}
                </div>

                <div>Bag by type: {renderCountsMap(u.bagAvailableByType)}</div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => startEditing(u)}>Edit details</button>

                  <button onClick={() => void setStatus(u.uid, "active")}>Activate</button>
                  <button onClick={() => void setStatus(u.uid, "inactive")}>Inactive</button>
                  <button onClick={() => void setStatus(u.uid, "suspended")}>Suspend</button>

                  <button onClick={() => void toggleAdmin(u.uid, true)}>Make admin</button>
                  <button onClick={() => void toggleAdmin(u.uid, false)}>Remove admin</button>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <label htmlFor={`user-level-${u.uid}`}>Level</label>
                    <select
                      id={`user-level-${u.uid}`}
                      style={{ ...inputStyle(), width: 180 }}
                      value={u.levelId ?? "free"}
                      onChange={(e) => void setLevel(u.uid, e.target.value)}
                    >
                      {levels.length > 0 ? (
                        levels.map((level) => (
                          <option key={level.id} value={level.id}>
                            {level.name ?? level.id}
                          </option>
                        ))
                      ) : (
                        <option value="free">free</option>
                      )}
                    </select>
                  </div>

                  <button onClick={() => void resetUserAvailability(u.uid)}>
                    Reset availability
                  </button>

                  {!u.emailVerified && (
                    <button
                      title="Check Firebase Auth and record verification timestamp if the user has now verified"
                      onClick={() => void syncEmailVerification(u.uid)}
                    >
                      Sync email verification
                    </button>
                  )}

                  <button onClick={() => void deleteUser(u.uid)}>Soft delete</button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16 }}>
          <button
            onClick={() => void loadUsers(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            Previous
          </button>

          <div>
            Page{" "}
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              style={{
                width: 60,
                marginInline: 6,
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid #5F7491",
                background: "#F4F7FB",
                color: "#0D1F33",
              }}
            />{" "}
            / {totalPages}
          </div>

          <button onClick={() => void goToPage()}>Go</button>

          <button
            onClick={() => void loadUsers(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      </div>

      <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
    </section>
  );
}