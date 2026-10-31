import type { AiProvider } from "@/lib/api/contract";
import type { Provider } from "./ai";

/** For tests: a stand-in provider that fails at everything unless told otherwise. */
export function fakeProvider(name: AiProvider, behaviour: Partial<Provider> & { configured?: () => boolean } = {}): Provider {
  const fail = () => Promise.reject(new Error(`${name} is busy`));
  return { name, configured: () => true, model: () => `${name}-model`, readKhataPhoto: fail, transcribeQuestion: fail, answerWithTools: fail, mapColumns: fail, ...behaviour };
}
