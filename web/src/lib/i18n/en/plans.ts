export const plans = {
  title: "Plans",
  description: "The khata is free. Asha's calls are what you pay for, and WhatsApp goes first, so calls stay few.",
  pilot: "Payments aren't live yet. During the pilot, any plan switches on at no charge.",
  current: "Your plan",
  perMonth: "/month",
  choose: "Switch to this plan",
  names: { free: "Khata", asha: "Asha", asha_plus: "Asha Plus" },
  features: {
    free: (photos: number) => ["Unlimited customers and entries", `${photos} photo reads a day`, "Ask your khata, by voice too", "WhatsApp reminders from your phone"],
    asha: (calls: number, photos: number) => ["Everything in Khata", `${calls} reminder calls a month, in 5 languages`, "Evening summary call on Saturdays", `${photos} photo reads a day`],
    asha_plus: (calls: number, photos: number) => ["Everything in Asha", `${calls} reminder calls a month`, "Evening summary call every day", `${photos} photo reads a day`],
  },
  usage: {
    callsLabel: "Calls",
    photosLabel: "Photos today",
    title: "What you've used",
    calls: (used: number, included: number) => `${used} of ${included} calls this month`,
    noCalls: "No calls on this plan",
    extra: (n: number) => `${n} calls left from call packs`,
    photos: (n: number, max: number) => `${n} of ${max} photos read today`,
  },
  pack: {
    title: "Call pack",
    body: (calls: number, price: string) => `${calls} more calls for ${price}, on any plan. They don't expire, and are used once the month's calls run out.`,
    add: "Add a call pack",
  },
  how: {
    title: "How reminders work",
    steps: (minDue: string, perCustomer: number) => [
      "Send a WhatsApp reminder from the customer's page.",
      "If nothing comes in after 3 days, Asha can call.",
      `Dues under ${minDue} get WhatsApp only, and nobody is called more than ${perCustomer} times a month.`,
    ],
  },
  switched: (name: string) => `You're on ${name} now.`,
  packAdded: (n: number) => `${n} calls added.`,
};
