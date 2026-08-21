import { useState } from 'react';
import { useStore } from './store';
import { LoadingScreen } from './components/Loading';
import { Header } from './components/Header';
import { BottomNav, type Tab } from './components/BottomNav';
import { Home } from './pages/Home';
import { Tasks } from './pages/Tasks';
import { Mine } from './pages/Mine';
import { StakePage } from './pages/Stake';
import { Referrals } from './pages/Referrals';
import { MenuSheet } from './sheets/MenuSheet';
import { WithdrawSheet } from './sheets/WithdrawSheet';
import { HistorySheet } from './sheets/HistorySheet';
import { DepositSheet } from './sheets/DepositSheet';
import { CheckinSheet } from './sheets/CheckinSheet';
import { LaunchSheet } from './sheets/LaunchSheet';
import { AdminSheet } from './sheets/AdminSheet';
import { ImportTokenSheet } from './sheets/ImportTokenSheet';

export default function App() {
  const { loading, error, me, refreshAll } = useStore();
  const [tab, setTab] = useState<Tab>('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  if (loading) return <LoadingScreen />;

  if (error && !me) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="text-5xl">❄️</div>
        <p className="text-lg font-bold">{error}</p>
        <button onClick={refreshAll} className="btn-primary px-6 py-3">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-night-900 hex-bg">
      <Header onMenu={() => setMenuOpen(true)} />

      <main className="pt-2">
        {tab === 'home' && (
          <Home
            onWithdraw={() => setWithdrawOpen(true)}
            onHistory={() => setHistoryOpen(true)}
            onDeposit={() => setDepositOpen(true)}
            onCheckin={() => setCheckinOpen(true)}
            onLaunch={() => setLaunchOpen(true)}
            onNavigate={setTab}
          />
        )}
        {tab === 'tasks' && <Tasks />}
        {tab === 'mine' && <Mine onDeposit={() => setDepositOpen(true)} />}
        {tab === 'stake' && <StakePage />}
        {tab === 'referrals' && <Referrals />}
      </main>

      <BottomNav tab={tab} onChange={setTab} />

      <MenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onHistory={() => setHistoryOpen(true)}
        onAdmin={() => setAdminOpen(true)}
        onImportToken={() => setImportOpen(true)}
      />
      <WithdrawSheet
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        onEarnMore={() => {
          setWithdrawOpen(false);
          setTab('tasks');
        }}
      />
      <HistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <DepositSheet open={depositOpen} onClose={() => setDepositOpen(false)} />
      <CheckinSheet open={checkinOpen} onClose={() => setCheckinOpen(false)} />
      <LaunchSheet open={launchOpen} onClose={() => setLaunchOpen(false)} />
      <AdminSheet open={adminOpen} onClose={() => setAdminOpen(false)} />
      <ImportTokenSheet open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
