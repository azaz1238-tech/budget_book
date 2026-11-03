import { useRef } from "react";

export default function DataManager({ busy, onBackup, onExportCsv, onRestoreFile }) {
  const fileInputRef = useRef(null);

  const handleFile = (event) => {
    const [file] = event.target.files;
    // 같은 파일을 다시 골라도 change가 오도록 비운다.
    event.target.value = "";
    if (file) onRestoreFile(file);
  };

  const button = (className, idle, working, kind, onClick) => (
    <button type="button" className={`button-secondary ${className}`} disabled={busy !== null} onClick={onClick}>
      {busy === kind ? working : idle}
    </button>
  );

  return (
    <section id="data-manager" className="card" aria-label="데이터">
      <h2>데이터</h2>
      <p className="data-note">백업 파일은 다른 드라이브나 클라우드 등 안전한 곳에 보관하세요. 복원하면 지금 데이터의 사본이 서버 폴더에 남습니다.</p>
      <div className="data-actions">
        {button("backup-button", "백업 다운로드", "백업 중...", "backup", onBackup)}
        {button("csv-button", "CSV 내보내기", "내보내는 중...", "csv", onExportCsv)}
        {button("restore-button", "백업 복원", "복원 중...", "restore", () => fileInputRef.current.click())}
        <input ref={fileInputRef} type="file" accept=".db" className="restore-input" hidden aria-label="복원할 백업 파일" onChange={handleFile} />
      </div>
    </section>
  );
}
