import type {Properties} from "../src/model.ts";
export interface PaymentEvent {
  global_step: string; step: string; ts: string; action: string; amount: string;
  sender_id: string; sender_type: string; receiver_id: string; receiver_type: string;
  is_fraud: string; is_flagged_fraud: string;
}
export function payment(value: unknown): PaymentEvent {
  if (!value || typeof value !== "object") throw new Error("Invalid payment object");
  const object = value as Record<string, unknown>;
  const keys = ["global_step", "step", "ts", "action", "amount", "sender_id", "sender_type", "receiver_id", "receiver_type", "is_fraud", "is_flagged_fraud"];
  for (const key of keys) if (typeof object[key] !== "string") throw new Error(`Invalid ${key}`);
  const event = object as unknown as PaymentEvent;
  if (!/^[1-9][0-9]*$/.test(event.global_step) || !Number.isSafeInteger(Number(event.global_step))) throw new Error("Invalid global_step");
  if (!event.amount.trim() || !Number.isFinite(Number(event.amount)) || Number(event.amount) < 0) throw new Error("Invalid amount");
  if (!/^C[0-9]+$/.test(event.sender_id) || !/^[CMB][0-9]+$/.test(event.receiver_id)) throw new Error("Invalid endpoint identifier");
  if (!["CLIENT", "MULE"].includes(event.sender_type) || !["CLIENT", "MULE", "MERCHANT", "BANK"].includes(event.receiver_type)) throw new Error("Invalid actor type");
  if (!Number.isFinite(Date.parse(event.ts))) throw new Error("Invalid timestamp");
  if (!["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"].includes(event.action)) throw new Error("Invalid action");
  if (!["true", "false"].includes(event.is_fraud) || !["true", "false"].includes(event.is_flagged_fraud)) throw new Error("Invalid fraud flag");
  return event;
}
export function transaction(event: PaymentEvent): {id: string; source: string; target: string; targetLabel: string; relationship: string; properties: Properties} {
  const targetLabel = event.receiver_type === "MERCHANT" ? "merchant" : event.receiver_type === "BANK" ? "bank" : "client";
  return {
    id: `transaction_T${event.global_step.padStart(6, "0")}`,
    source: `client_${event.sender_id}`, target: `${targetLabel}_${event.receiver_id}`, targetLabel,
    relationship: `to_${targetLabel}`,
    properties: {amount: Math.round(Number(event.amount) * 100) / 100, timestamp: event.ts, action: event.action,
      globalstep: Number(event.global_step), isfraud: event.is_fraud === "true", isflaggedfraud: event.is_flagged_fraud === "true",
      typeorig: event.sender_type, typedest: event.receiver_type}
  };
}
