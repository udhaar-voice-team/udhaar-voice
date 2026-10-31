/** The public page a WhatsApp reminder links to, shown to the customer in their language. */
export const pay = {
  title: (shop: string) => `Pay ${shop}`,
  due: (amount: string) => `Pending: ${amount}`,
  part: "Pay all of it or part of it: type the amount in your UPI app.",
  button: "Pay with a UPI app",
  scan: "Or scan this QR code with any UPI app. On this phone, download it and pick it from the gallery in your UPI app.",
  download: "Download QR code",
  upiId: "UPI ID",
  copy: "Copy",
  copied: "Copied",
  invalid: "This payment link is incomplete. Ask the shop to send it again.",
};
