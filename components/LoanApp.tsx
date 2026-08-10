"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Repayment = {
  id: string;
  date: string;
  principal: number;
  note?: string;
};

type LoanRecord = {
  id: string;
  drawDate: string;
  amount: number;
  note: string;
  repayments: Repayment[];
};

type Settlement = {
  paidDate: string;
  paidAmount: number;
  note?: string;
};

type AppState = {
  settings: {
    loanLimit: number;
    annualRate: number;
    dayBasis: number;
    paymentDay: number;
  };
  records: LoanRecord[];
  settlements: Record<string, Settlement>;
};

type NavKey = "dashboard" | "records" | "months" | "calculator" | "settings";
type CloudStatus = "offline" | "connecting" | "online" | "error";
type FamilyStatus = "local" | "loading" | "creating" | "owner" | "viewer" | "error";

type FirebaseDocRef = {
  get: () => Promise<{ exists: boolean; data: () => { state?: AppState } | undefined }>;
  set: (data: unknown, options?: { merge: boolean }) => Promise<void>;
};

type FirebaseAppCompat = {
  auth: () => {
    signInWithPopup: (provider: unknown) => Promise<{ user: { uid: string; email?: string | null } }>;
  };
  firestore: () => {
    collection: (name: string) => {
      doc: (id: string) => {
        collection: (childName: string) => { doc: (childId: string) => FirebaseDocRef };
      };
    };
  };
};

type FirebaseCompat = {
  apps: unknown[];
  app: () => FirebaseAppCompat;
  initializeApp: (config: Record<string, unknown>) => FirebaseAppCompat;
  auth: { GoogleAuthProvider: new () => unknown };
  firestore: { FieldValue: { serverTimestamp: () => unknown } };
};

declare global {
  interface Window {
    firebase?: FirebaseCompat;
  }
}

const STORAGE_KEY = "jacky-loan-ledger-v2";
const FIREBASE_KEY = "jacky-loan-ledger-firebase-config";
const FAMILY_SHARE_ID_KEY = "jacky-loan-ledger-family-share-id";
const FAMILY_WRITE_TOKEN_KEY = "jacky-loan-ledger-family-write-token";
const FAMILY_API = "https://jacky-loan-ledger.familywu5-3.chatgpt.site/api/shared-ledger";
const FAMILY_PAGE = "https://starnight0516-source.github.io/jacky-loan-ledger/";
const MS_DAY = 86_400_000;

const defaultState: AppState = {
  settings: {
    loanLimit: 6_920_000,
    annualRate: 0.0356,
    dayBasis: 365,
    paymentDay: 5,
  },
  records: [
    {
      id: "LN-20260730-001",
      drawDate: "2026-07-30",
      amount: 50_000,
      note: "初始領款紀錄",
      repayments: [],
    },
  ],
  settlements: {},
};

function localToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dayNumber(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / MS_DAY;
}

function fromDayNumber(serial: number) {
  const d = new Date(serial * MS_DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function monthStart(key: string) {
  return `${key}-01`;
}

function monthEnd(key: string) {
  const [y, m] = key.split("-").map(Number);
  return fromDayNumber(Date.UTC(y, m, 0) / MS_DAY);
}

function previousMonthEnd(key: string) {
  return fromDayNumber(dayNumber(monthStart(key)) - 1);
}

function shiftMonth(key: string, offset: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dueDate(key: string, paymentDay: number) {
  return `${shiftMonth(key, 1)}-${String(paymentDay).padStart(2, "0")}`;
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${y}/${m}/${d}`;
}

function formatMonth(key: string) {
  const [y, m] = key.split("-");
  return `${y} 年 ${Number(m)} 月`;
}

function money(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(Math.round(value || 0));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function repaymentTotal(record: LoanRecord, asOf: string) {
  return record.repayments
    .filter((item) => item.date <= asOf)
    .reduce((sum, item) => sum + item.principal, 0);
}

function outstanding(record: LoanRecord, asOf: string) {
  return Math.max(0, record.amount - repaymentTotal(record, asOf));
}

function interestPeriodLabel(record: LoanRecord, asOf: string) {
  const start = fromDayNumber(dayNumber(record.drawDate) + 1);
  let principal = record.amount;
  let end = asOf;
  const repayments = [...record.repayments]
    .filter((item) => item.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const repayment of repayments) {
    principal = Math.max(0, principal - repayment.principal);
    if (principal <= 0) {
      end = repayment.date;
      break;
    }
  }

  if (dayNumber(start) > dayNumber(end)) {
    return principal > 0 ? `${formatDate(start)} 起息` : "無計息日";
  }
  return `${formatDate(start)}–${formatDate(end)}`;
}

function overlapDays(segmentStartExclusive: string, segmentEndInclusive: string, rangeStartExclusive: string, rangeEndInclusive: string) {
  const start = Math.max(dayNumber(segmentStartExclusive), dayNumber(rangeStartExclusive));
  const end = Math.min(dayNumber(segmentEndInclusive), dayNumber(rangeEndInclusive));
  return Math.max(0, end - start);
}

function recordInterestForRange(
  record: LoanRecord,
  rangeStartExclusive: string,
  rangeEndInclusive: string,
  annualRate: number,
  dayBasis: number,
) {
  if (record.drawDate >= rangeEndInclusive || record.amount <= 0) return 0;
  let principal = record.amount;
  let cursor = record.drawDate;
  let interest = 0;
  const repayments = [...record.repayments].sort((a, b) => a.date.localeCompare(b.date));

  for (const repayment of repayments) {
    if (principal <= 0) break;
    const segmentEnd = repayment.date;
    const days = overlapDays(cursor, segmentEnd, rangeStartExclusive, rangeEndInclusive);
    interest += principal * annualRate * days / dayBasis;
    principal = Math.max(0, principal - repayment.principal);
    cursor = segmentEnd;
  }

  if (principal > 0 && cursor < rangeEndInclusive) {
    const days = overlapDays(cursor, rangeEndInclusive, rangeStartExclusive, rangeEndInclusive);
    interest += principal * annualRate * days / dayBasis;
  }
  return interest;
}

function monthInterest(records: LoanRecord[], key: string, asOf: string, annualRate: number, dayBasis: number) {
  const end = monthEnd(key) < asOf ? monthEnd(key) : asOf;
  if (monthStart(key) > asOf) return 0;
  return records.reduce(
    (sum, record) => sum + recordInterestForRange(record, previousMonthEnd(key), end, annualRate, dayBasis),
    0,
  );
}

function lifetimeInterest(record: LoanRecord, asOf: string, annualRate: number, dayBasis: number) {
  return recordInterestForRange(record, record.drawDate, asOf, annualRate, dayBasis);
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("無法載入雲端同步元件"));
    document.head.appendChild(script);
  });
}

function downloadText(filename: string, text: string, mime = "application/json") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function LoanApp() {
  const [state, setState] = useState<AppState>(defaultState);
  const [hydrated, setHydrated] = useState(false);
  const [today, setToday] = useState("2026-08-10");
  const [active, setActive] = useState<NavKey>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState<"draw" | "repay" | "settle" | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [toast, setToast] = useState("");
  const [firebaseText, setFirebaseText] = useState("");
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>("offline");
  const [cloudEmail, setCloudEmail] = useState("");
  const [calculatorAmount, setCalculatorAmount] = useState(100_000);
  const [calculatorStart, setCalculatorStart] = useState("");
  const [calculatorEnd, setCalculatorEnd] = useState("");
  const [familyStatus, setFamilyStatus] = useState<FamilyStatus>("local");
  const [familyShareId, setFamilyShareId] = useState("");
  const [familyUpdatedAt, setFamilyUpdatedAt] = useState<number | null>(null);
  const [familySyncing, setFamilySyncing] = useState(false);
  const cloudDocRef = useRef<FirebaseDocRef | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- hydrate client-only date and persisted browser data */
  useEffect(() => {
    setToday(localToday());
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setState(JSON.parse(stored));
      } catch {
        setToast("本機資料格式異常，已載入預設資料");
      }
    }
    setFirebaseText(localStorage.getItem(FIREBASE_KEY) ?? "");
    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!cloudDocRef.current || cloudStatus !== "online") return;
    const timer = window.setTimeout(() => {
      cloudDocRef.current.set({ state, updatedAt: window.firebase?.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [state, hydrated, cloudStatus]);

  /* eslint-disable react-hooks/set-state-in-effect -- load authoritative family ledger after local hydration */
  useEffect(() => {
    if (!hydrated) return;
    const urlShareId = new URLSearchParams(window.location.search).get("share")?.trim() ?? "";
    const savedShareId = localStorage.getItem(FAMILY_SHARE_ID_KEY) ?? "";
    const id = urlShareId || savedShareId;
    if (!/^[a-f0-9]{36}$/.test(id)) return;

    let cancelled = false;
    const writeToken = localStorage.getItem(FAMILY_WRITE_TOKEN_KEY) ?? "";
    const owner = savedShareId === id && /^[a-f0-9]{64}$/.test(writeToken);
    setFamilyStatus("loading");
    setFamilyShareId(id);

    async function loadFamilyLedger() {
      try {
        const response = await fetch(`${FAMILY_API}?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("shared_ledger_unavailable");
        const payload = await response.json() as { state: AppState; updatedAt: number };
        if (cancelled) return;
        setState(payload.state);
        setFamilyUpdatedAt(payload.updatedAt);
        setFamilyStatus(owner ? "owner" : "viewer");
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setFamilyStatus("error");
          setToast("家庭共用資料暫時無法載入，請稍後重新整理");
        }
      }
    }

    loadFamilyLedger();
    const poller = owner ? null : window.setInterval(loadFamilyLedger, 30_000);
    return () => {
      cancelled = true;
      if (poller) window.clearInterval(poller);
    };
  }, [hydrated]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated || familyStatus !== "owner" || !familyShareId) return;
    const writeToken = localStorage.getItem(FAMILY_WRITE_TOKEN_KEY) ?? "";
    if (!writeToken) return;
    const timer = window.setTimeout(async () => {
      setFamilySyncing(true);
      try {
        const response = await fetch(FAMILY_API, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${writeToken}` },
          body: JSON.stringify({ id: familyShareId, state }),
        });
        if (!response.ok) throw new Error("family_sync_failed");
        const payload = await response.json() as { updatedAt: number };
        setFamilyUpdatedAt(payload.updatedAt);
      } catch (error) {
        console.error(error);
        setToast("家庭共用同步失敗，資料仍保留在本機");
      } finally {
        setFamilySyncing(false);
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [state, hydrated, familyStatus, familyShareId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const settings = state.settings;
  const recordNumberById = useMemo(() => Object.fromEntries(
    [...state.records].reverse().map((record, index) => [record.id, index + 1]),
  ), [state.records]);
  const currentMonth = monthKey(today);
  const priorMonth = shiftMonth(currentMonth, -1);

  const metrics = useMemo(() => {
    const totalDrawn = state.records.reduce((sum, record) => sum + record.amount, 0);
    const totalRepaid = state.records.reduce((sum, record) => sum + repaymentTotal(record, today), 0);
    const outstandingPrincipal = state.records.reduce((sum, record) => sum + outstanding(record, today), 0);
    const available = clamp(settings.loanLimit - totalDrawn + totalRepaid, 0, settings.loanLimit);
    const lifetime = state.records.reduce(
      (sum, record) => sum + lifetimeInterest(record, today, settings.annualRate, settings.dayBasis),
      0,
    );
    const paidInterest = Object.values(state.settlements)
      .filter((settlement) => settlement.paidDate && settlement.paidDate <= today)
      .reduce((sum, settlement) => sum + settlement.paidAmount, 0);
    const unpaidInterestTotal = Math.max(0, lifetime - paidInterest);
    const currentInterest = monthInterest(state.records, currentMonth, today, settings.annualRate, settings.dayBasis);
    const priorInterest = monthInterest(state.records, priorMonth, today, settings.annualRate, settings.dayBasis);
    return { totalDrawn, totalRepaid, outstandingPrincipal, available, lifetime, paidInterest, unpaidInterestTotal, currentInterest, priorInterest };
  }, [state.records, state.settlements, settings, today, currentMonth, priorMonth]);

  const monthRows = useMemo(() => {
    const recordMonths = state.records.map((record) => monthKey(record.drawDate)).sort();
    const earliest = recordMonths[0] ?? currentMonth;
    const rows: string[] = [];
    let cursor = earliest;
    while (cursor <= currentMonth && rows.length < 180) {
      rows.push(cursor);
      cursor = shiftMonth(cursor, 1);
    }
    return rows.map((key) => {
      const interest = monthInterest(state.records, key, today, settings.annualRate, settings.dayBasis);
      const settlement = state.settlements[key];
      const end = monthEnd(key);
      const due = dueDate(key, settings.paymentDay);
      let status = "累計中";
      if (end < today) {
        if (settlement?.paidDate) {
          const diff = settlement.paidAmount - interest;
          status = Math.abs(diff) <= 1 ? "已繳清" : diff < 0 ? "金額不足" : "溢繳";
        } else {
          status = due < today ? "逾期未繳" : "待繳";
        }
      }
      return { key, interest, settlement, end, due, status };
    }).reverse();
  }, [state.records, state.settlements, settings.annualRate, settings.dayBasis, settings.paymentDay, today, currentMonth]);

  const unpaidInterest = monthRows
    .filter((row) => row.end < today && !row.settlement?.paidDate)
    .reduce((sum, row) => sum + row.interest, 0);

  const trendRows = [...monthRows].reverse().slice(-6);
  const maxTrend = Math.max(1, ...trendRows.map((row) => row.interest));
  const daysInMonth = dayNumber(monthEnd(currentMonth)) - dayNumber(previousMonthEnd(currentMonth));
  const elapsedDays = Math.max(0, dayNumber(today) - dayNumber(previousMonthEnd(currentMonth)));
  const calculatorStartDate = calculatorStart || today;
  const calculatorEndDate = calculatorEnd || fromDayNumber(dayNumber(calculatorStartDate) + 30);
  const calculatorDays = Math.max(0, dayNumber(calculatorEndDate) - dayNumber(calculatorStartDate));
  const calculatorDailyInterest = calculatorAmount > 0
    ? calculatorAmount * settings.annualRate / settings.dayBasis
    : 0;
  const calculatorInterest = calculatorDailyInterest * calculatorDays;
  const calculatorTotal = Math.max(0, calculatorAmount) + calculatorInterest;
  const calculatorDateInvalid = calculatorEndDate < calculatorStartDate;

  function notify(message: string) {
    setToast(message);
  }

  function familyShareUrl(id = familyShareId) {
    return `${FAMILY_PAGE}?share=${encodeURIComponent(id)}`;
  }

  async function copyFamilyLink(id = familyShareId) {
    const url = familyShareUrl(id);
    try {
      await navigator.clipboard.writeText(url);
      notify("家庭查看連結已複製，可以直接傳給太太");
    } catch {
      window.prompt("請複製這組家庭查看連結", url);
    }
  }

  async function enableFamilySharing() {
    setFamilyStatus("creating");
    try {
      const response = await fetch(FAMILY_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (!response.ok) throw new Error("family_create_failed");
      const payload = await response.json() as { id: string; writeToken: string; updatedAt: number };
      localStorage.setItem(FAMILY_SHARE_ID_KEY, payload.id);
      localStorage.setItem(FAMILY_WRITE_TOKEN_KEY, payload.writeToken);
      setFamilyShareId(payload.id);
      setFamilyUpdatedAt(payload.updatedAt);
      setFamilyStatus("owner");
      await copyFamilyLink(payload.id);
    } catch (error) {
      console.error(error);
      setFamilyStatus("error");
      notify("家庭共用建立失敗，請稍後再試一次");
    }
  }

  function setCalculatorDuration(days: number) {
    setCalculatorEnd(fromDayNumber(dayNumber(calculatorStartDate) + days));
  }

  function openRepay(recordId: string) {
    setSelectedRecord(recordId);
    setModal("repay");
  }

  function openSettlement(key: string) {
    setSelectedMonth(key);
    setModal("settle");
  }

  function deleteRecord(id: string) {
    if (!window.confirm("確定刪除這筆領款及其全部還款紀錄嗎？")) return;
    setState((current) => ({ ...current, records: current.records.filter((record) => record.id !== id) }));
    notify("已刪除領款紀錄");
  }

  function addDraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    const drawDate = String(form.get("drawDate"));
    if (!amount || amount <= 0 || !drawDate) return;
    const record: LoanRecord = {
      id: makeId("LN"),
      drawDate,
      amount,
      note: String(form.get("note") ?? ""),
      repayments: [],
    };
    setState((current) => ({ ...current, records: [record, ...current.records] }));
    setModal(null);
    notify("領款紀錄已新增，利息已開始計算");
  }

  function addRepayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const principal = Number(form.get("principal"));
    const date = String(form.get("date"));
    const record = state.records.find((item) => item.id === selectedRecord);
    if (!record || !principal || principal <= 0 || !date) return;
    const maxPrincipal = Math.max(0, record.amount - record.repayments.reduce((sum, item) => sum + item.principal, 0));
    if (principal > maxPrincipal) {
      notify(`還款本金不可超過 ${money(maxPrincipal)}`);
      return;
    }
    setState((current) => ({
      ...current,
      records: current.records.map((item) => item.id === selectedRecord
        ? {
            ...item,
            repayments: [...item.repayments, {
              id: makeId("RP"),
              date,
              principal,
              note: String(form.get("note") ?? ""),
            }].sort((a, b) => a.date.localeCompare(b.date)),
          }
        : item),
    }));
    setModal(null);
    notify("本金還款已登記，可貸餘額已自動回補");
  }

  function saveSettlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const paidDate = String(form.get("paidDate"));
    const paidAmount = Number(form.get("paidAmount"));
    if (!selectedMonth || !paidDate || paidAmount < 0) return;
    setState((current) => ({
      ...current,
      settlements: {
        ...current.settlements,
        [selectedMonth]: { paidDate, paidAmount, note: String(form.get("note") ?? "") },
      },
    }));
    setModal(null);
    notify(`${formatMonth(selectedMonth)}繳息已登記`);
  }

  function updateSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState((current) => ({
      ...current,
      settings: {
        loanLimit: Number(form.get("loanLimit")),
        annualRate: Number(form.get("annualRate")) / 100,
        dayBasis: Number(form.get("dayBasis")),
        paymentDay: Number(form.get("paymentDay")),
      },
    }));
    notify("計息設定已更新，所有月份已重新計算");
  }

  function exportJson() {
    downloadText(`貸款利息備份_${today}.json`, JSON.stringify(state, null, 2));
    notify("完整備份已下載");
  }

  function exportCsv() {
    const header = ["領款編號", "領款日期", "領款金額", "已還本金", "未還本金", "截至今日利息", "計息期間", "備註"];
    const rows = state.records.map((record) => [
      recordNumberById[record.id],
      record.drawDate,
      record.amount,
      repaymentTotal(record, today),
      outstanding(record, today),
      Math.round(lifetimeInterest(record, today, settings.annualRate, settings.dayBasis)),
      interestPeriodLabel(record, today),
      record.note.replaceAll('"', '""'),
    ]);
    const csv = "\uFEFF" + [header, ...rows].map((row) => row.map((value) => `"${value}"`).join(",")).join("\n");
    downloadText(`貸款明細_${today}.csv`, csv, "text/csv");
    notify("Excel 可開啟的 CSV 已下載");
  }

  function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed.settings || !Array.isArray(parsed.records)) throw new Error("invalid");
        setState(parsed);
        notify("備份資料已成功匯入");
      } catch {
        notify("匯入失敗：不是有效的貸款備份檔");
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  }

  async function connectFirebase() {
    setCloudStatus("connecting");
    try {
      const config = JSON.parse(firebaseText) as Record<string, unknown>;
      localStorage.setItem(FIREBASE_KEY, firebaseText);
      await loadScript("https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js");
      await loadScript("https://www.gstatic.com/firebasejs/11.0.2/firebase-auth-compat.js");
      await loadScript("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore-compat.js");
      const firebase = window.firebase;
      if (!firebase) throw new Error("Firebase SDK 尚未完成載入");
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
      const auth = app.auth();
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      const user = result.user;
      const ref = app.firestore().collection("users").doc(user.uid).collection("apps").doc("loan-ledger");
      const snapshot = await ref.get();
      if (snapshot.exists && snapshot.data()?.state) {
        setState(snapshot.data().state);
      } else {
        await ref.set({ state, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
      cloudDocRef.current = ref;
      setCloudEmail(user.email ?? "Google 帳號");
      setCloudStatus("online");
      notify("雲端同步已連線，資料會自動更新");
    } catch (error) {
      console.error(error);
      setCloudStatus("error");
      notify("雲端連線失敗，請檢查 Firebase 設定與網域授權");
    }
  }

  const navItems: { key: NavKey; label: string; caption: string }[] = [
    { key: "dashboard", label: "儀表總覽", caption: "整體額度與利息" },
    { key: "records", label: "動用與還款", caption: "本金異動紀錄" },
    { key: "months", label: "月結利息", caption: "月底結算與繳息" },
    { key: "calculator", label: "利息試算", caption: "領款前預估成本" },
    { key: "settings", label: "設定與備份", caption: "參數與雲端同步" },
  ];
  const isFamilyViewer = familyStatus === "viewer";
  const visibleNavItems = isFamilyViewer ? navItems.filter((item) => item.key !== "settings") : navItems;

  const selectedLoan = state.records.find((record) => record.id === selectedRecord);
  const selectedLoanRemaining = selectedLoan
    ? Math.max(0, selectedLoan.amount - selectedLoan.repayments.reduce((sum, item) => sum + item.principal, 0))
    : 0;
  const selectedMonthRow = monthRows.find((row) => row.key === selectedMonth);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">LF</div>
          <div>
            <strong>LoanFlow</strong>
            <span>貸款利息管理系統</span>
          </div>
        </div>

        <nav className="main-nav" aria-label="主要導覽">
          {visibleNavItems.map((item, index) => (
            <button
              key={item.key}
              className={active === item.key ? "active" : ""}
              onClick={() => { setActive(item.key); setSidebarOpen(false); }}
            >
              <span className="nav-index">0{index + 1}</span>
              <span><b>{item.label}</b><small>{item.caption}</small></span>
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <div className={`status-dot ${familyStatus === "owner" || familyStatus === "viewer" ? "online" : cloudStatus}`}></div>
          <div>
            <b>{familyStatus === "viewer" ? "家庭查看模式" : familyStatus === "owner" ? "家庭雲端同步" : cloudStatus === "online" ? "雲端同步中" : "本機安全模式"}</b>
            <span>{familyStatus === "viewer" ? "唯讀顯示共用帳本" : familyStatus === "owner" ? (familySyncing ? "正在同步最新資料" : "夫妻共用資料已連線") : cloudStatus === "online" ? cloudEmail : "資料儲存在此裝置"}</span>
          </div>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" aria-label="關閉選單" onClick={() => setSidebarOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="開啟選單">☰</button>
          <div>
            <p>{formatDate(today)} · 即時更新</p>
            <h1>{navItems.find((item) => item.key === active)?.label}</h1>
          </div>
          <div className="top-actions">
            {isFamilyViewer && <span className="viewer-chip">唯讀查看</span>}
            <span className="rate-chip">年利率 <b>{(settings.annualRate * 100).toFixed(2)}%</b></span>
            {!isFamilyViewer && <button className="primary-button" onClick={() => setModal("draw")}><span>＋</span> 新增領款</button>}
          </div>
        </header>

        {active === "dashboard" && (
          <div className="page-content">
            {isFamilyViewer && (
              <section className="family-view-banner">
                <div><b>家庭共用帳本</b><span>您目前以唯讀方式查看 Jacky 分享的完整貸款紀錄。</span></div>
                <small>{familyUpdatedAt ? `雲端更新：${new Date(familyUpdatedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}` : "正在確認最新資料"}</small>
              </section>
            )}
            {unpaidInterest > 0 && (
              <section className="due-alert">
                <div className="alert-icon">!</div>
                <div><b>目前有已結算但尚未登記繳納的利息</b><span>請至「月結利息」確認繳款狀態。</span></div>
                <strong>{money(unpaidInterest)}</strong>
                <button onClick={() => setActive("months")}>前往處理</button>
              </section>
            )}

            <section className="kpi-grid">
              <MetricCard label="目前可貸餘額" value={money(metrics.available)} note={`總額度 ${money(settings.loanLimit)}`} tone="navy" />
              <MetricCard label="目前未還本金" value={money(metrics.outstandingPrincipal)} note={`累計領出 ${money(metrics.totalDrawn)}`} tone="blue" />
              <InterestMetricCard total={metrics.lifetime} paid={metrics.paidInterest} unpaid={metrics.unpaidInterestTotal} />
              <MetricCard label="本月尚未結算利息" value={money(metrics.currentInterest)} note={`截至 ${formatDate(today)} · 月底結算`} tone="amber" />
            </section>

            <section className="dashboard-grid">
              <article className="panel month-progress-panel">
                <div className="panel-heading">
                  <div><span className="eyebrow">CURRENT CYCLE</span><h2>{formatMonth(currentMonth)}結算進度</h2></div>
                  <span className="live-badge">累計中</span>
                </div>
                <div className="progress-amount">
                  <div><span>本月已累計</span><strong>{money(metrics.currentInterest)}</strong></div>
                  <div><span>預定結算日</span><b>{formatDate(monthEnd(currentMonth))}</b></div>
                  <div><span>預定繳款日</span><b>{formatDate(dueDate(currentMonth, settings.paymentDay))}</b></div>
                </div>
                <div className="progress-track"><span style={{ width: `${Math.min(100, elapsedDays / daysInMonth * 100)}%` }} /></div>
                <div className="progress-labels"><span>本月第 {elapsedDays} 天</span><span>{Math.round(elapsedDays / daysInMonth * 100)}%</span><span>共 {daysInMonth} 天</span></div>
                <div className="cycle-summary">
                  <div><span>上月結算利息</span><b>{money(metrics.priorInterest)}</b></div>
                  <div><span>本期繳款日</span><b>{formatDate(dueDate(priorMonth, settings.paymentDay))}</b></div>
                  <div><span>已還本金</span><b>{money(metrics.totalRepaid)}</b></div>
                </div>
              </article>

              <article className="panel trend-panel">
                <div className="panel-heading"><div><span className="eyebrow">MONTHLY TREND</span><h2>近六月利息走勢</h2></div></div>
                <div className="bar-chart" aria-label="近六月利息長條圖">
                  {trendRows.map((row) => (
                    <div className="bar-item" key={row.key}>
                      <span className="bar-value">{money(row.interest)}</span>
                      <div className="bar-rail"><span style={{ height: `${Math.max(5, row.interest / maxTrend * 100)}%` }} /></div>
                      <b>{Number(row.key.slice(5))}月</b>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="panel records-preview">
              <div className="panel-heading">
                <div><span className="eyebrow">RECENT ACTIVITY</span><h2>目前貸款明細</h2></div>
                <button className="text-button" onClick={() => setActive("records")}>查看全部 →</button>
              </div>
              <RecordTable records={state.records.slice(0, 5)} today={today} settings={settings} numberById={recordNumberById} onRepay={openRepay} onDelete={deleteRecord} compact readOnly={isFamilyViewer} />
            </section>
          </div>
        )}

        {active === "records" && (
          <div className="page-content">
            <section className="section-intro">
              <div><span className="eyebrow">PRINCIPAL LEDGER</span><h2>領款與本金還款紀錄</h2><p>每筆領款可分次還款；系統會依實際還款日期切分每日本金與利息。</p></div>
              {!isFamilyViewer && <button className="primary-button" onClick={() => setModal("draw")}>＋ 新增領款</button>}
            </section>
            <section className="mini-stats">
              <div><span>累計領出</span><b>{money(metrics.totalDrawn)}</b></div>
              <div><span>累計還本金</span><b>{money(metrics.totalRepaid)}</b></div>
              <div><span>未還本金</span><b>{money(metrics.outstandingPrincipal)}</b></div>
            </section>
            <section className="panel records-full">
              <RecordTable records={state.records} today={today} settings={settings} numberById={recordNumberById} onRepay={openRepay} onDelete={deleteRecord} readOnly={isFamilyViewer} />
            </section>
          </div>
        )}

        {active === "months" && (
          <div className="page-content">
            <section className="section-intro">
              <div><span className="eyebrow">MONTH-END SETTLEMENT</span><h2>每月應繳利息</h2><p>每月底自動結算，次月 {settings.paymentDay} 日繳納；回補或修正歷史紀錄時，各月份會同步重算。</p></div>
            </section>
            <section className="month-highlight-grid">
              <div className="highlight-card"><span>本月截至今日</span><strong>{money(metrics.currentInterest)}</strong><small>{formatDate(today)} 即時計算</small></div>
              <div className="highlight-card"><span>上月已結算</span><strong>{money(metrics.priorInterest)}</strong><small>{formatDate(dueDate(priorMonth, settings.paymentDay))} 應繳</small></div>
              <div className={`highlight-card ${unpaidInterest > 0 ? "warning" : "success"}`}><span>尚未登記繳納</span><strong>{money(unpaidInterest)}</strong><small>{unpaidInterest > 0 ? "請確認歷史繳款" : "目前沒有未繳項目"}</small></div>
            </section>
            <section className="panel monthly-table-panel">
              <div className="table-scroll">
                <table className="data-table monthly-table">
                  <thead><tr><th>結算月份</th><th>結算日</th><th>應繳利息</th><th>次月繳款日</th><th>實際繳款</th><th>差額</th><th>狀態</th><th></th></tr></thead>
                  <tbody>
                    {monthRows.map((row) => {
                      const diff = row.settlement ? row.settlement.paidAmount - row.interest : null;
                      return (
                        <tr key={row.key}>
                          <td><b>{formatMonth(row.key)}</b>{row.key === currentMonth && <span className="current-tag">本月</span>}</td>
                          <td>{formatDate(row.end)}</td>
                          <td className="money-cell"><b>{money(row.interest)}</b></td>
                          <td>{formatDate(row.due)}</td>
                          <td>{row.settlement ? <><b>{money(row.settlement.paidAmount)}</b><small>{formatDate(row.settlement.paidDate)}</small></> : "—"}</td>
                          <td className={diff != null && Math.abs(diff) > 1 ? "negative" : ""}>{diff == null ? "—" : money(diff)}</td>
                          <td><StatusBadge status={row.status} /></td>
                          <td>{!isFamilyViewer && row.end < today && <button className="row-button" onClick={() => openSettlement(row.key)}>{row.settlement ? "修改" : "登記繳息"}</button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {active === "calculator" && (
          <div className="page-content calculator-page">
            <section className="section-intro">
              <div>
                <span className="eyebrow">LOAN INTEREST ESTIMATOR</span>
                <h2>貸款利息試算</h2>
                <p>在正式領款前先評估資金成本；試算內容不會儲存至正式帳本，也不會影響可貸餘額。</p>
              </div>
              <span className="calculator-rate">目前年利率 <b>{(settings.annualRate * 100).toFixed(2)}%</b></span>
            </section>

            <section className="calculator-grid">
              <article className="panel calculator-form-card">
                <div className="panel-heading">
                  <div><span className="eyebrow">PLANNED LOAN</span><h2>預定貸款條件</h2></div>
                  <span className="draft-badge">僅供試算</span>
                </div>

                <div className="calculator-fields">
                  <label>
                    預估領出金額
                    <span className="amount-input"><b>NT$</b><input type="number" min="0" step="1000" value={calculatorAmount || ""} onChange={(event) => setCalculatorAmount(Number(event.target.value))} placeholder="例如 500000" /></span>
                  </label>
                  <div className="form-row">
                    <label>預定領款日期<input type="date" value={calculatorStartDate} onChange={(event) => setCalculatorStart(event.target.value)} /></label>
                    <label>預定還款日期<input type="date" min={calculatorStartDate} value={calculatorEndDate} onChange={(event) => setCalculatorEnd(event.target.value)} /></label>
                  </div>
                </div>

                <div className="term-selector">
                  <span>快速選擇貸款期間</span>
                  <div className="term-presets">
                    {[30, 60, 90, 180].map((days) => (
                      <button key={days} type="button" className={calculatorDays === days ? "active" : ""} onClick={() => setCalculatorDuration(days)}>{days} 天</button>
                    ))}
                  </div>
                </div>

                <div className="calculation-rule">
                  <span>計算方式</span>
                  <b>預估金額 × {(settings.annualRate * 100).toFixed(2)}% ÷ {settings.dayBasis} 天 × 計息天數</b>
                  <small>領款日不計息，預定還款日仍計息，與正式帳本規則一致。</small>
                </div>
              </article>

              <article className="panel calculator-result-card" aria-live="polite">
                <div className="result-heading"><span className="eyebrow">ESTIMATED RESULT</span><h2>試算結果</h2></div>
                {calculatorDateInvalid ? (
                  <div className="calculator-error"><b>日期期間不正確</b><span>預定還款日期不可早於領款日期。</span></div>
                ) : (
                  <>
                    <div className="estimate-hero">
                      <span>預估利息</span>
                      <strong>{money(calculatorInterest)}</strong>
                      <small>{formatDate(calculatorStartDate)} 領款 · {formatDate(calculatorEndDate)} 還款</small>
                    </div>
                    <dl className="estimate-summary">
                      <div><dt>預估金額</dt><dd>{money(calculatorAmount)}</dd></div>
                      <div><dt>預定貸款期間</dt><dd>{calculatorDays} 天</dd></div>
                      <div><dt>每日預估利息</dt><dd>{money(calculatorDailyInterest)}</dd></div>
                      <div className="total"><dt>預估本金＋利息</dt><dd>{money(calculatorTotal)}</dd></div>
                    </dl>
                  </>
                )}
                <p className="estimate-note">此結果供資金規劃參考；實際利息會依正式領款、還款日期及本金異動重新計算。</p>
              </article>
            </section>
          </div>
        )}

        {active === "settings" && (
          <div className="page-content settings-page">
            <section className="settings-grid">
              <section className="panel settings-card family-share-card">
                <div className="panel-heading">
                  <div><span className="eyebrow">FAMILY SHARING</span><h2>家庭共用帳本</h2></div>
                  <span className={`cloud-pill ${familyStatus === "owner" ? "online" : familyStatus === "error" ? "error" : ""}`}>{familyStatus === "owner" ? "共用中" : familyStatus === "creating" || familyStatus === "loading" ? "連線中" : familyStatus === "error" ? "連線異常" : "尚未啟用"}</span>
                </div>
                {familyStatus === "owner" ? (
                  <>
                    <p>完整帳本已安全同步至雲端。將唯讀連結傳給太太，她即可看到與您相同的最新紀錄。</p>
                    <div className="family-share-summary"><span>雲端資料</span><b>{state.records.length} 筆領款紀錄</b></div>
                    <button className="primary-button full" type="button" onClick={() => copyFamilyLink()}>複製太太專用查看連結</button>
                    <small className="security-note">只有持有專用連結的人能查看；新增、刪除及還款登記仍由您這台裝置管理。</small>
                  </>
                ) : (
                  <>
                    <p>啟用後會把目前完整資料上傳至家庭雲端，並產生一組太太可以直接開啟的唯讀連結。</p>
                    <button className="primary-button full" type="button" onClick={enableFamilySharing} disabled={familyStatus === "creating" || familyStatus === "loading"}>{familyStatus === "creating" ? "正在建立家庭帳本…" : "啟用家庭共用並複製連結"}</button>
                    <small className="security-note">原本儲存在瀏覽器中的紀錄不會被刪除，仍可下載 JSON 備份。</small>
                  </>
                )}
              </section>

              <form className="panel settings-card" onSubmit={updateSettings}>
                <div className="panel-heading"><div><span className="eyebrow">CALCULATION</span><h2>貸款與計息設定</h2></div></div>
                <label>可貸總額<input name="loanLimit" type="number" min="0" defaultValue={settings.loanLimit} /></label>
                <label>年利率（%）<input name="annualRate" type="number" min="0" step="0.01" defaultValue={(settings.annualRate * 100).toFixed(2)} /></label>
                <div className="form-row"><label>年計息基準<select name="dayBasis" defaultValue={settings.dayBasis}><option value="365">365 日</option><option value="366">366 日</option><option value="360">360 日</option></select></label><label>次月繳款日<input name="paymentDay" type="number" min="1" max="28" defaultValue={settings.paymentDay} /></label></div>
                <p className="formula-note">計算規則：每日本金 × 年利率 ÷ 年計息基準；領款日不計息，還款日仍計息。</p>
                <button className="primary-button full" type="submit">儲存並重新計算</button>
              </form>

              <section className="panel settings-card cloud-card">
                <div className="panel-heading"><div><span className="eyebrow">CLOUD SYNC</span><h2>Firebase 雲端同步</h2></div><span className={`cloud-pill ${cloudStatus}`}>{cloudStatus === "online" ? "已連線" : cloudStatus === "connecting" ? "連線中" : "未連線"}</span></div>
                <p>貼上 Firebase Web App 設定後，以 Google 帳號登入。資料會儲存在該帳號專屬空間並跨裝置同步。</p>
                <label>Firebase 設定 JSON<textarea value={firebaseText} onChange={(event) => setFirebaseText(event.target.value)} placeholder={'{\n  "apiKey": "...",\n  "authDomain": "...",\n  "projectId": "..."\n}'} /></label>
                <button className="secondary-button full" onClick={connectFirebase} disabled={cloudStatus === "connecting"}>{cloudStatus === "online" ? `已連線：${cloudEmail}` : "使用 Google 帳號連線"}</button>
                <small className="security-note">請在 Firebase Authentication 啟用 Google 登入，並套用專案附帶的 Firestore 安全規則。</small>
              </section>

              <section className="panel settings-card backup-card">
                <div className="panel-heading"><div><span className="eyebrow">BACKUP</span><h2>資料備份與匯出</h2></div></div>
                <p>JSON 可完整備份與還原；CSV 可直接用 Excel 開啟分析。</p>
                <div className="backup-actions">
                  <button className="secondary-button" onClick={exportJson}>下載完整備份</button>
                  <button className="secondary-button" onClick={exportCsv}>匯出 Excel CSV</button>
                  <button className="ghost-button" onClick={() => importRef.current?.click()}>匯入 JSON 備份</button>
                  <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={importBackup} />
                </div>
                <div className="backup-summary"><span>最後本機儲存</span><b>即時自動儲存</b></div>
              </section>

              <section className="panel settings-card about-card">
                <div className="panel-heading"><div><span className="eyebrow">SYSTEM</span><h2>系統資訊</h2></div></div>
                <dl><div><dt>版本</dt><dd>2.0 Web</dd></div><div><dt>計息方式</dt><dd>單利／按日計算</dd></div><div><dt>結算週期</dt><dd>每月最後一日</dd></div><div><dt>資料筆數</dt><dd>{state.records.length} 筆領款</dd></div></dl>
              </section>
            </section>
          </div>
        )}
      </main>

      {!isFamilyViewer && modal === "draw" && (
        <Modal title="新增領款紀錄" subtitle="新增後將從領款日翌日起開始計息" onClose={() => setModal(null)}>
          <form className="modal-form" onSubmit={addDraw}>
            <label>領出日期<input name="drawDate" type="date" max={today} defaultValue={today} required /></label>
            <label>領出金額<input name="amount" type="number" min="1" step="1" placeholder="例如 50000" required autoFocus /></label>
            <label>備註<input name="note" type="text" placeholder="例如：車款、投資資金" /></label>
            <div className="modal-actions"><button type="button" className="ghost-button" onClick={() => setModal(null)}>取消</button><button type="submit" className="primary-button">確認新增</button></div>
          </form>
        </Modal>
      )}

      {!isFamilyViewer && modal === "repay" && selectedLoan && (
        <Modal title="登記本金還款" subtitle={`目前未還本金 ${money(selectedLoanRemaining)}`} onClose={() => setModal(null)}>
          <form className="modal-form" onSubmit={addRepayment}>
            <label>還款日期<input name="date" type="date" min={selectedLoan.drawDate} max={today} defaultValue={today} required /></label>
            <label>還款本金<input name="principal" type="number" min="1" max={selectedLoanRemaining} defaultValue={selectedLoanRemaining} required autoFocus /></label>
            <label>備註<input name="note" type="text" placeholder="例如：部分還款、全數清償" /></label>
            <div className="modal-actions"><button type="button" className="ghost-button" onClick={() => setModal(null)}>取消</button><button type="submit" className="primary-button">確認還款</button></div>
          </form>
        </Modal>
      )}

      {!isFamilyViewer && modal === "settle" && selectedMonthRow && (
        <Modal title={`${formatMonth(selectedMonth)}繳息登記`} subtitle={`應繳利息 ${money(selectedMonthRow.interest)}`} onClose={() => setModal(null)}>
          <form className="modal-form" onSubmit={saveSettlement}>
            <label>實際繳款日期<input name="paidDate" type="date" defaultValue={selectedMonthRow.settlement?.paidDate ?? today} required /></label>
            <label>實際繳納利息<input name="paidAmount" type="number" min="0" defaultValue={Math.round(selectedMonthRow.settlement?.paidAmount ?? selectedMonthRow.interest)} required autoFocus /></label>
            <label>備註<input name="note" type="text" defaultValue={selectedMonthRow.settlement?.note ?? ""} placeholder="例如：自動扣款" /></label>
            <div className="modal-actions"><button type="button" className="ghost-button" onClick={() => setModal(null)}>取消</button><button type="submit" className="primary-button">儲存繳款</button></div>
          </form>
        </Modal>
      )}

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function MetricCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <article className={`metric-card ${tone}`}><div className="metric-top"><span>{label}</span><i></i></div><strong>{value}</strong><small>{note}</small></article>;
}

function InterestMetricCard({ total, paid, unpaid }: { total: number; paid: number; unpaid: number }) {
  return (
    <article className="metric-card interest-metric teal">
      <div className="metric-top"><span>截至今日累計利息</span><i></i></div>
      <strong>{money(total)}</strong>
      <div className="interest-breakdown">
        <div className="paid"><span>已繳利息</span><b>{money(paid)}</b></div>
        <div className="unpaid"><span>未繳利息</span><b>{money(unpaid)}</b></div>
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  const key = status.includes("已繳") ? "paid" : status.includes("逾期") || status.includes("不足") ? "overdue" : status.includes("待繳") ? "due" : status.includes("累計") ? "active" : "neutral";
  return <span className={`status-badge ${key}`}>{status}</span>;
}

function RecordTable({ records, today, settings, numberById, onRepay, onDelete, compact = false, readOnly = false }: {
  records: LoanRecord[];
  today: string;
  settings: AppState["settings"];
  numberById: Record<string, number>;
  onRepay: (id: string) => void;
  onDelete: (id: string) => void;
  compact?: boolean;
  readOnly?: boolean;
}) {
  if (!records.length) return <div className="empty-state"><b>還沒有領款紀錄</b><span>按右上角「新增領款」開始記錄。</span></div>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead><tr><th>編號／領出日期</th><th>領出金額</th><th>已還本金</th><th>未還本金</th><th>截至今日利息／計息期間</th><th>狀態</th><th></th></tr></thead>
        <tbody>
          {records.map((record) => {
            const repaid = repaymentTotal(record, today);
            const balance = outstanding(record, today);
            const interest = lifetimeInterest(record, today, settings.annualRate, settings.dayBasis);
            return (
              <tr key={record.id}>
                <td><b>{numberById[record.id]}</b><small>{formatDate(record.drawDate)}{record.note ? ` · ${record.note}` : ""}</small></td>
                <td className="money-cell">{money(record.amount)}</td>
                <td>{money(repaid)}</td>
                <td className="money-cell"><b>{money(balance)}</b></td>
                <td><b>{money(interest)}</b><small>計息 {interestPeriodLabel(record, today)}</small></td>
                <td><StatusBadge status={balance <= 0 ? "已清償" : repaid > 0 ? "部分還款" : "計息中"} /></td>
                <td className="row-actions">{!readOnly && balance > 0 && <button className="row-button" onClick={() => onRepay(record.id)}>登記還款</button>}{!readOnly && !compact && <button className="delete-button" onClick={() => onDelete(record.id)}>刪除</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={onClose} aria-label="關閉">×</button></div>
        {children}
      </section>
    </div>
  );
}
