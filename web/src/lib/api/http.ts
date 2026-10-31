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
  verifySignUp: json("verifySignUp"),
  resendSignUpCode: json("resendSignUpCode"),
  signOut: json("signOut"),
  updateProfile: json("updateProfile"),
  changePassword: json("changePassword"),
  getShop: json("getShop"),
  updateShop: json("updateShop"),
  listCustomers: json("listCustomers"),
  listReminderCandidates: json("listReminderCandidates"),
  getCustomer: json("getCustomer"),
  addCustomer: json("addCustomer"),
  updateCustomer: json("updateCustomer"),
  archiveCustomer: json("archiveCustomer"),
  addEntry: json("addEntry"),
  recordPayment: json("recordPayment"),
  updateEntry: json("updateEntry"),
  deleteEntry: json("deleteEntry"),
  updatePayment: json("updatePayment"),
  deletePayment: json("deletePayment"),
  resolveDispute: json("resolveDispute"),
  listCalls: json("listCalls"),
  getCall: json("getCall"),
  scheduleReminders: json("scheduleReminders"),
  rescheduleCall: json("rescheduleCall"),
  cancelCall: json("cancelCall"),
  listBatches: json("listBatches"),
  rescheduleBatch: json("rescheduleBatch"),
  cancelBatch: json("cancelBatch"),
  extractKhata: (input) => {
    if (!input.photo) return json("extractKhata")(input);
    const form = new FormData();
    form.append("source", input.source);
    form.append("photo", input.photo, "khata.jpg");
    if (input.scanId) form.append("scanId", input.scanId);
    if (input.provider) form.append("provider", input.provider);
    return call("extractKhata", { body: form });
  },
  saveKhata: json("saveKhata"),
  listKhataImports: json("listKhataImports"),
  undoKhataImport: json("undoKhataImport"),
  ask: json("ask"),
  transcribe: (audio, provider) => {
    const form = new FormData();
    form.append("audio", audio);
    if (provider) form.append("provider", provider);
    return call("transcribe", { body: form });
  },
  getDashboard: json("getDashboard"),
  getDailyReport: json("getDailyReport"),
  sendReportCall: json("sendReportCall"),
  getGraph: json("getGraph"),
  getPlan: json("getPlan"),
  setPlan: json("setPlan"),
  addCallPack: json("addCallPack"),
  logWhatsappReminder: json("logWhatsappReminder"),
  startDemoCall: json("startDemoCall"),
};
