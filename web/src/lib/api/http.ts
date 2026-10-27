import type { UdhaarApi } from "./contract";

/** The browser's side of the API contract: each method is a POST to /api/udhaar/<method>. */

async function call<T>(method: keyof UdhaarApi, init: RequestInit): Promise<T> {
  const res = await fetch(`/api/udhaar/${method}`, { method: "POST", credentials: "same-origin", ...init });
  const body = (await res.json().catch(() => null)) as { data?: T; error?: string } | null;
  if (!res.ok || !body || body.error !== undefined) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body.data as T;
}

const json =
  <K extends keyof UdhaarApi>(method: K) =>
  (...args: Parameters<UdhaarApi[K]>) =>
    call<Awaited<ReturnType<UdhaarApi[K]>>>(method, { headers: { "content-type": "application/json" }, body: JSON.stringify({ args }) });

export const httpApi: UdhaarApi = {
  getSession: json("getSession"),
  signIn: json("signIn"),
  signUp: json("signUp"),
  signOut: json("signOut"),
  updateProfile: json("updateProfile"),
  getShop: json("getShop"),
  updateShop: json("updateShop"),
  listCustomers: json("listCustomers"),
  listReminderCandidates: json("listReminderCandidates"),
  getCustomer: json("getCustomer"),
  updateCustomer: json("updateCustomer"),
  addEntry: json("addEntry"),
  recordPayment: json("recordPayment"),
  resolveDispute: json("resolveDispute"),
  listCalls: json("listCalls"),
  getCall: json("getCall"),
  scheduleReminders: json("scheduleReminders"),
  rescheduleCall: json("rescheduleCall"),
  cancelCall: json("cancelCall"),
  listBatches: json("listBatches"),
  rescheduleBatch: json("rescheduleBatch"),
  cancelBatch: json("cancelBatch"),
  extractKhata: json("extractKhata"),
  saveKhata: json("saveKhata"),
  listKhataImports: json("listKhataImports"),
  undoKhataImport: json("undoKhataImport"),
  ask: json("ask"),
  transcribe: (audio) => {
    const form = new FormData();
    form.append("audio", audio);
    return call("transcribe", { body: form });
  },
  getDashboard: json("getDashboard"),
  getDailyReport: json("getDailyReport"),
  sendReportCall: json("sendReportCall"),
  getGraph: json("getGraph"),
  startDemoCall: json("startDemoCall"),
};
