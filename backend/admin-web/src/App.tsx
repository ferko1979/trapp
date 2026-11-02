import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { isAdminUser, observeAuth } from "./auth";
import Dashboard from "./components/Dashboard";
import LoginPage from "./components/LoginPage";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    const unsub = observeAuth(async (u) => {
      setUser(u);
      if (!u) {
        setAdmin(false);
        setLoading(false);
        return;
      }
      setAdmin(await isAdminUser());
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!user) return <LoginPage />;

  if (!admin) {
    return (
      <div style={{ padding: 24 }}>
        Logged in as {user.email ?? user.phoneNumber ?? user.uid}, but this account is not an admin.
      </div>
    );
  }

  return <Dashboard user={user} />;
}
