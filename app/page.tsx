import { ConnectPanel } from "./ConnectPanel";
import { RadioIdentityHelp } from "./RadioIdentityHelp";
import { SelfTestPanel } from "./SelfTestPanel";
import { BackupPanel } from "./BackupPanel";
import { WritePanel } from "./WritePanel";
import { ConfigPanel } from "./ConfigPanel";
import { SplashTestPanel } from "./SplashTestPanel";
import { StockFirmwareGuide } from "./StockFirmwareGuide";

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px",
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>bkg-programmer</h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
          Quansheng UV-K5 / UV-K1 (F4HWN firmware) — local-only, in-browser.
        </p>
      </header>
      <ConnectPanel />
      <RadioIdentityHelp />
      <StockFirmwareGuide />
      <SelfTestPanel />
      <WritePanel />
      <ConfigPanel />
      <BackupPanel />
      <SplashTestPanel />
    </main>
  );
}
