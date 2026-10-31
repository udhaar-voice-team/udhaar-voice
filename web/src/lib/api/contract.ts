import type {
  Call,
  CallingHours,
  CallOutcome,
  Customer,
  CustomerStatus,
  Dispute,
  KhataImport,
  Language,
  LedgerEntry,
  Note,
  Payment,
  PaymentPromise,
  PlanId,
  ReminderBatch,
  Shop,
  User,
} from "@/lib/domain/types";

/**
 * The API every screen talks to. The browser reaches it through lib/api/http.ts; the server
 * implements it in lib/server/api.ts on Supabase. Screens must only depend on this file.
 */

export type CustomerSummary = {
  customer: Customer;
  balance: number;
  status: CustomerStatus;
  lastCall?: { id: string; at: string; status: Call["status"]; outcome?: CallOutcome };
  lastReminderAt?: string;
  /** Earliest open promise. */
  nextPromise?: PaymentPromise;
  openDispute?: Dispute;
};

export type CustomerDetail = CustomerSummary & {
  entries: LedgerEntry[];
  payments: Payment[];
  promises: PaymentPromise[];
  disputes: Dispute[];
  notes: Note[];
  calls: Call[];
  /** What the agent will be told at the start of the next call. */
  memory: string;
};

/**
 * Where a call waiting for a free line stands. Lines are shared by every shop on our Bolna account
 * (2 on a trial account), so a call can wait even when its own shop has nothing else running.
 */
export type QueueSpot = {
  /** 1 = next to get a line. */
  position: number;
  lines: number;
  busyLines: number;
  /** Rough estimate. */
  waitSeconds: number;
};

export type CallListItem = { call: Call; customer?: Customer; queue?: QueueSpot };
export type CallDetail = CallListItem & { batch?: ReminderBatch };

export type BatchSummary = {
  batch: ReminderBatch;
  calls: CallListItem[];
  /** `removed`: cancelled before they ran. `done`: every other finished call. */
  counts: { waiting: number; active: number; done: number; removed: number };
  outcomes: Partial<Record<CallOutcome, number>>;
  /** True until the batch starts dialing; after that only waiting customers can be removed. */
  canChangeTime: boolean;
};

export type AttentionItem = {
  kind: "overdue" | "dispute" | "callback" | "wrong_number" | "refused" | "low_confidence";
  customer: Customer;
  text: string;
  callId?: string;
};

export type DashboardData = {
  totalPending: number;
  customersOwing: number;
  promisedThisWeek: { amount: number; count: number };
  collectedThisWeek: number;
  collectedToday: number;
  openDisputes: number;
  attention: AttentionItem[];
  upcoming: { promise: PaymentPromise; customer: Customer }[];
  recentCalls: CallListItem[];
  /** Last 7 days, oldest first. */
  byDay: { date: string; collected: number; promised: number }[];
  activeBatch?: BatchSummary;
};

export type DailyReport = {
  date: string;
  collected: number;
  payments: { customer: Customer; payment: Payment }[];
  promisesMade: { customer: Customer; promise: PaymentPromise }[];
  dueTomorrow: { customer: Customer; promise: PaymentPromise }[];
  disputesOpened: { customer: Customer; dispute: Dispute }[];
  callsMade: number;
  callsAnswered: number;
  productRequests: { customer: Customer; note: Note }[];
  /** The spoken summary the evening call reads out, in each language. */
  spoken: Record<Language, string>;
};

export type GraphNodeType = "shop" | "customer" | "promise" | "dispute" | "note" | "product";
export type GraphNode = {
  id: string;
  type: GraphNodeType;
  label: string;
  /** Customer status, promise status, etc. Used for colour. */
  state?: string;
  /** Rupees for customers and promises; drives node size. */
  amount?: number;
  customerId?: string;
  detail?: string;
};
export type GraphEdgeKind = "owes" | "promised" | "disputed" | "said" | "asked_for";
export type GraphEdge = { id: string; source: string; target: string; kind: GraphEdgeKind };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export type KhataField<T> = {
  value: T;
  confidence: number;
  /** What was crossed out on the page; `value` is what was written over it. */
  struck?: T;
};
export type KhataRowAction = "add" | "update" | "skip";
export type KhataRow = {
  id: string;
  name: KhataField<string>;
  nameNative?: string;
  amount: KhataField<number>;
  date: KhataField<string>;
  items: KhataField<string>;
  /** Existing customer this row was matched to, if any. */
  matchCustomerId?: string;
  phone?: string;
  language: Language;
  /** A saved entry this row repeats ("duplicate") or changes ("changed"). */
  saved?: { kind: "duplicate" | "changed"; entryId: string; amount: number; items: string };
  /** What saving does with the row: add a new entry, update `saved`, or nothing. */
  action: KhataRowAction;
};
/** Where an import came from: a photo, the sample page, typed lines or a spreadsheet. */
export type KhataSource = "sample" | "upload" | "manual" | "file";
/** `model` is the model that read a photo. */
export type KhataExtraction = { scanId: string; source: KhataSource; rows: KhataRow[]; model?: string };
/** One khata line typed in or read from a spreadsheet. `date` is YYYY-MM-DD. */
export type KhataLineInput = { name: string; nameNative?: string; amount: number; items: string; date: string; phone?: string };
export type KhataSaveResult = { importId: string; added: number; updated: number; newCustomers: number };
export type KhataImportSummary = { import: KhataImport; added: number; updated: number; amount: number };
export type KhataUndoResult = { removed: number; restored: number; customersRemoved: number };

export type AskAnswer = {
  question: string;
  answer: string;
  /** The tool the assistant called, shown to make the function-calling visible. */
  tool: string;
  items?: { label: string; value?: string; href?: string }[];
  action?: { label: string; href: string };
};

/** Speech-to-text result for a question spoken to the khata. */
export type Transcription = { text: string; language: Language };

/** The AI model providers, in the order they are tried. */
export type AiProvider = "gemini" | "meta";
/**
 * One try at reading or answering. When it fails and another provider is set up, `next` names the
 * provider to ask instead, in a new request, so each gets a full request's time and the screen can
 * say what is happening.
 */
export type AiStep<T> = { result: T } | { next: AiProvider };

export type ScheduleInput = {
  customerIds: string[];
  /** ISO timestamp, or "now". */
  at: string;
  language: "auto" | Language;
  bypassHours: boolean;
};
export type ScheduleResult = {
  batch?: ReminderBatch;
  skipped: { customer: Customer; reason: string }[];
  /** Set when the requested time is outside calling hours. Nothing is scheduled; the shopkeeper picks another time. */
  outsideHours?: CallingHours;
};

export type RescheduleResult = {
  call: Call;
  /** Set when the requested time is outside calling hours. The call is unchanged; the shopkeeper picks another time. */
  outsideHours?: CallingHours;
};

export type RescheduleBatchResult = {
  batch: ReminderBatch;
  /** Set when the requested time is outside calling hours. Nothing changes; the shopkeeper picks another time. */
  outsideHours?: CallingHours;
};

export type EligibleCustomer = CustomerSummary & {
  eligible: boolean;
  /** Why the customer cannot be called right now. */
  reason?: string;
  /** Something the shopkeeper should know before calling (e.g. an open dispute). */
  note?: string;
};

export type DemoCallResult =
  /** A real call is on its way to the visitor's phone. */
  | { allowed: true; real: true; language: Language }
  /** Real demo calls are off: the conversation the call would have, to play on screen. */
  | { allowed: true; real: false; language: Language; turns: Call["transcript"]; extraction: NonNullable<Call["extraction"]> }
  | { allowed: false; reason: string };

export type Session = { user: User; shop: Shop };

/** The shop's plan and what it has used of it. */
export type PlanUsage = {
  plan: PlanId;
  /** Reminder calls placed or scheduled this month. */
  callsUsed: number;
  callsIncluded: number;
  /** Calls left from call packs. */
  extraCalls: number;
  photoReadsToday: number;
  photoReadsPerDay: number;
};

/** The identifier is either a 10-digit Indian mobile or an email address. */
export type SignInInput = { identifier: string; password: string };
/** Signed in straight away, or a code was emailed to `verifyEmail` (when Supabase confirms emails). */
export type SignUpResult = { session: Session } | { verifyEmail: string };

export type SignUpInput = {
  phone: string;
  /** Required: accounts sign in by email underneath, even when the shopkeeper types their phone. */
  email: string;
  password: string;
  ownerName: string;
  shopName: string;
  /** The evening summary's language, and the default for new customers. */
  language: Language;
};

/** The signed-in shopkeeper's own details, kept on both their account and their shop. */
export type ProfileInput = {
  name: string;
  /** 10-digit Indian mobile: the shop's contact number and where the evening summary is called. */
  phone: string;
  /** Used to sign in. */
  email: string;
  shopName: string;
  upiId: string;
};

export interface UdhaarApi {
  /** Returns the active session, or null when no one is signed in. */
  getSession(): Promise<Session | null>;
  /** Throws on invalid credentials. */
  signIn(input: SignInInput): Promise<Session>;
  /** Throws if the phone or email is already registered or validation fails. */
  signUp(input: SignUpInput): Promise<SignUpResult>;
  /** Finishes a sign-up with the code emailed to the shopkeeper. Throws if the code is wrong or expired. */
  verifySignUp(input: { email: string; code: string }): Promise<Session>;
  resendSignUpCode(input: { email: string }): Promise<void>;
  signOut(): Promise<void>;
  /** Throws if validation fails or the phone or email belongs to another account. */
  updateProfile(input: ProfileInput): Promise<Session>;
  /** Throws if the current password is wrong or the new one is too short. */
  changePassword(input: { current: string; next: string }): Promise<void>;

  getShop(): Promise<Shop>;
  updateShop(patch: Partial<Omit<Shop, "id">>): Promise<Shop>;

  listCustomers(): Promise<CustomerSummary[]>;
  listReminderCandidates(): Promise<EligibleCustomer[]>;
  getCustomer(id: string): Promise<CustomerDetail | null>;
  /** Throws if another customer already has the phone number. */
  addCustomer(input: { name: string; nameNative?: string; phone?: string; language: Language }): Promise<Customer>;
  /** Removes a customer from the khata: archived, so their history stays, and their waiting calls are cancelled. */
  archiveCustomer(id: string): Promise<void>;
  updateCustomer(id: string, patch: Partial<Pick<Customer, "name" | "nameNative" | "phone" | "language" | "optedOut">>): Promise<Customer>;
  addEntry(input: { customerId: string; amount: number; items: string; date: string; source: LedgerEntry["source"] }): Promise<LedgerEntry>;
  recordPayment(input: { customerId: string; amount: number; method: Payment["method"]; date: string }): Promise<Payment>;
  /** Corrects a saved entry. */
  updateEntry(id: string, patch: { amount: number; items: string; date: string }): Promise<void>;
  /** Removes an entry from the khata; it is kept, voided, for history. */
  deleteEntry(id: string): Promise<void>;
  updatePayment(id: string, patch: { amount: number; method: Payment["method"]; date: string }): Promise<void>;
  /** Removes a payment from the khata; it is kept, voided, for history. */
  deletePayment(id: string): Promise<void>;
  resolveDispute(id: string): Promise<void>;

  listCalls(): Promise<CallListItem[]>;
  getCall(id: string): Promise<CallDetail | null>;
  scheduleReminders(input: ScheduleInput): Promise<ScheduleResult>;
  /** Move a scheduled call to a new time. Throws if the call is no longer in a schedulable state. */
  rescheduleCall(id: string, at: string, bypassHours: boolean): Promise<RescheduleResult>;
  /** Cancel a scheduled or queued call. No-op if it has already run or been cancelled. */
  cancelCall(id: string): Promise<void>;
  listBatches(): Promise<BatchSummary[]>;
  /** Move every waiting call in a batch to a new time. Throws once the batch has started dialing. */
  rescheduleBatch(id: string, at: string, bypassHours: boolean): Promise<RescheduleBatchResult>;
  cancelBatch(id: string): Promise<void>;

  /**
   * "upload" reads `photo` (a JPEG or PNG under 4 MB) and keeps it as `scanId` (a UUID the browser
   * makes); a later try with the same `scanId` and no photo reads the kept one, with `provider`.
   * "sample" reads the drawn sample page; "manual" and "file" take `lines` typed in or read from a spreadsheet.
   */
  extractKhata(input: { source: KhataSource; photo?: Blob; scanId?: string; lines?: KhataLineInput[]; provider?: AiProvider }): Promise<AiStep<KhataExtraction>>;
  saveKhata(input: { scanId: string; source: KhataExtraction["source"]; rows: KhataRow[]; model?: string }): Promise<KhataSaveResult>;
  /** Recent photo imports, newest first. */
  listKhataImports(): Promise<KhataImportSummary[]>;
  /** Removes what an import added and restores what it changed. Customers it created go too, unless they have other records. */
  undoKhataImport(id: string): Promise<KhataUndoResult>;

  /** With every provider failing, the keyword assistant answers. */
  ask(question: string, provider?: AiProvider): Promise<AiStep<AskAnswer>>;
  /** Turns a recorded voice question (WAV or WebM, in any of the app's languages) into text for `ask`. */
  transcribe(audio: Blob, provider?: AiProvider): Promise<AiStep<Transcription>>;
  getDashboard(): Promise<DashboardData>;
  getDailyReport(): Promise<DailyReport>;
  sendReportCall(): Promise<Call>;
  getGraph(): Promise<GraphData>;

  getPlan(): Promise<PlanUsage>;
  /** Payments aren't live yet: during the pilot a shop switches plans at no charge. */
  setPlan(plan: PlanId): Promise<PlanUsage>;
  /** Adds a call pack's calls (lib/domain/rules.ts CALL_PACK). */
  addCallPack(): Promise<PlanUsage>;
  /** The shopkeeper sent a WhatsApp reminder to this customer; Asha may call a few days later. */
  logWhatsappReminder(customerId: string): Promise<void>;

  /** Public demo page: a reminder call to the visitor, playing a customer of the demo shop. */
  startDemoCall(input: { phone: string; language: Language; name?: string }): Promise<DemoCallResult>;
}
