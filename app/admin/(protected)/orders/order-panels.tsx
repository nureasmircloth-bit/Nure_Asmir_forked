"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useLockedAction } from "@/lib/use-locked-action";
import { ADMIN_CANCEL_REASONS } from "@/lib/order-rules";
import { ApiButton, callApi, Dialog, Hint, useToast } from "../../_ui/client";
import { Icon } from "../../_ui/icons";

/** Small "copy" helper: phone numbers, addresses and tracking numbers get pasted into TCS and WhatsApp all day. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="a-btn a-btn-sm a-btn-quiet"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast("Copied — you can paste it now.", "good");
        } catch {
          toast("Could not copy. Please select the text and press Ctrl + C.", "bad");
        }
      }}
    >
      <Icon name="copy" size={15} /> {label}
    </button>
  );
}

/** Runs a dialog form that sends one request, locks while sending, and refreshes the page afterwards. */
function useSubmit(url: string, method: "POST" | "PATCH", success: string, onDone: () => void) {
  const router = useRouter();
  const toast = useToast();
  const action = useLockedAction();
  const [error, setError] = useState("");
  async function submit(body: unknown) {
    await action.run(async () => {
      setError("");
      const result = await callApi(url, method, body);
      if (result.ok) {
        toast(success, "good");
        const warning = (result.data as { courierWarning?: string | null }).courierWarning;
        if (warning) toast(warning, "info");
        const notice = (result.data as { courierNotice?: { tone: "good" | "bad" | "info"; text: string } | null }).courierNotice;
        if (notice) toast(notice.text, notice.tone);
        onDone();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }
  return { submit, pending: action.pending, error };
}

function SubmitRow({ pending, onCancel, label, busy, danger = false }: { pending: boolean; onCancel: () => void; label: string; busy: string; danger?: boolean }) {
  return (
    <div className="a-dialog-actions">
      <button type="button" className="a-btn" onClick={onCancel} disabled={pending}>
        Close
      </button>
      <button className={`a-btn ${danger ? "a-btn-danger-solid" : "a-btn-primary"}`} disabled={pending} aria-busy={pending}>
        {pending ? (
          <span className="busy-label">
            <span className="spinner spinner-light" aria-hidden="true" /> {busy}
          </span>
        ) : (
          label
        )}
      </button>
    </div>
  );
}

/* ----------------------------------- cancel ---------------------------------- */

export function CancelOrderButton({ orderId, orderNumber, hasTracking, paid }: { orderId: string; orderNumber: string; hasTracking: boolean; paid: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(ADMIN_CANCEL_REASONS[0].value);
  const [note, setNote] = useState("");
  const { submit, pending, error } = useSubmit(`/api/admin/orders/${orderId}/cancel`, "POST", `Order ${orderNumber} cancelled. The stock is back on the shelf.`, () => setOpen(false));
  return (
    <>
      <button type="button" className="a-btn a-btn-danger" onClick={() => setOpen(true)}>
        Cancel this order
      </button>
      {open && (
        <Dialog title={`Cancel order ${orderNumber}?`} onClose={() => (pending ? undefined : setOpen(false))}>
          <form
            className="a-stack"
            style={{ gap: 14 }}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void submit({ reason, note: note || undefined });
            }}
          >
            <p>The stock goes back on the shelf and the customer is told. {hasTracking ? "The TCS booking will be cancelled too. " : ""}You cannot undo this.</p>
            {paid && <p className="a-note warn">This order was already paid. A refund request will be created for you automatically.</p>}
            <div className="a-field">
              <label htmlFor="cancel-reason">Why are you cancelling?</label>
              <select id="cancel-reason" value={reason} onChange={(event) => setReason(event.target.value)}>
                {ADMIN_CANCEL_REASONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="a-field">
              <label htmlFor="cancel-note">Note (optional)</label>
              <input id="cancel-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="Only you can see this" />
            </div>
            {error && <p className="a-error" role="alert">{error}</p>}
            <SubmitRow pending={pending} onCancel={() => setOpen(false)} label="Yes, cancel the order" busy="Cancelling…" danger />
          </form>
        </Dialog>
      )}
    </>
  );
}

/* ------------------------------- edit customer -------------------------------- */

export type CustomerFields = { customerName: string; customerPhone: string; customerEmail: string; city: string; province: string; address: string; deliveryNotes: string };

export function EditDetailsButton({ orderId, initial, hasTracking }: { orderId: string; initial: CustomerFields; hasTracking: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const { submit, pending, error } = useSubmit(`/api/admin/orders/${orderId}`, "PATCH", "Details saved.", () => setOpen(false));
  const set = (key: keyof CustomerFields) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <>
      <button type="button" className="a-btn a-btn-sm" onClick={() => { setForm(initial); setOpen(true); }}>
        <Icon name="edit" size={15} /> Fix details
      </button>
      {open && (
        <Dialog title="Fix customer details" onClose={() => (pending ? undefined : setOpen(false))} wide>
          <form
            className="a-stack"
            style={{ gap: 14 }}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void submit({ ...form, customerEmail: form.customerEmail || null, deliveryNotes: form.deliveryNotes || null });
            }}
          >
            {hasTracking && <p className="a-note warn">This order already has a TCS tracking number. Changing the address here does not change it at TCS — please update it on the TCS website too.</p>}
            <div className="a-form-grid">
              <div className="a-field">
                <label htmlFor="ed-name">Customer name</label>
                <input id="ed-name" value={form.customerName} onChange={set("customerName")} required />
              </div>
              <div className="a-field">
                <label htmlFor="ed-phone">Mobile number</label>
                <input id="ed-phone" value={form.customerPhone} onChange={set("customerPhone")} required inputMode="tel" placeholder="03001234567" />
              </div>
              <div className="a-field">
                <label htmlFor="ed-city">City</label>
                <input id="ed-city" value={form.city} onChange={set("city")} required />
              </div>
              <div className="a-field">
                <label htmlFor="ed-province">Province</label>
                <input id="ed-province" value={form.province} onChange={set("province")} required />
              </div>
              <div className="a-field wide">
                <label htmlFor="ed-address">Full address</label>
                <textarea id="ed-address" value={form.address} onChange={set("address")} required rows={3} />
              </div>
              <div className="a-field">
                <label htmlFor="ed-email">Email (optional)</label>
                <input id="ed-email" type="email" value={form.customerEmail} onChange={set("customerEmail")} />
              </div>
              <div className="a-field">
                <label htmlFor="ed-notes">Note for the rider (optional)</label>
                <input id="ed-notes" value={form.deliveryNotes} onChange={set("deliveryNotes")} placeholder="e.g. call before coming" />
              </div>
            </div>
            {error && <p className="a-error" role="alert">{error}</p>}
            <SubmitRow pending={pending} onCancel={() => setOpen(false)} label="Save details" busy="Saving…" />
          </form>
        </Dialog>
      )}
    </>
  );
}

/* ------------------------------------ TCS ------------------------------------ */

export type BookDefaults = { phone: string; city: string; address: string; cod: number; pieces: number; weight: number };

export function BookTcsButton({ orderId, defaults, connected }: { orderId: string; defaults: BookDefaults; connected: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ phone: defaults.phone, city: defaults.city, address: defaults.address, cod: String(defaults.cod), pieces: String(defaults.pieces), weight: String(defaults.weight), fragile: false, remarks: "" });
  const { submit, pending, error } = useSubmit(`/api/admin/orders/${orderId}/courier`, "POST", "Booked with TCS. The tracking number is saved on this order.", () => setOpen(false));
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <>
      <button type="button" className="a-btn a-btn-primary" onClick={() => setOpen(true)} disabled={!connected} title={connected ? undefined : "Connect your TCS account in Settings first"}>
        <Icon name="truck" /> Book with TCS
      </button>
      {open && (
        <Dialog title="Book this parcel with TCS" onClose={() => (pending ? undefined : setOpen(false))} wide>
          <form
            className="a-stack"
            style={{ gap: 14 }}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void submit({
                action: "book",
                customerPhone: form.phone,
                cityName: form.city,
                address: form.address,
                codAmount: Number(form.cod || 0),
                pieces: Number(form.pieces || 1),
                weightKg: Number(form.weight || 0.5),
                fragile: form.fragile,
                remarks: form.remarks || undefined,
              });
            }}
          >
            <p className="a-muted">Check these details. TCS will send a rider to collect the parcel from your pickup address.</p>
            <div className="a-form-grid">
              <div className="a-field">
                <label htmlFor="bk-phone">Customer mobile</label>
                <input id="bk-phone" value={form.phone} onChange={set("phone")} required inputMode="tel" placeholder="03001234567" />
                <span className="a-help">Must be a mobile number like 03xx xxxxxxx.</span>
              </div>
              <div className="a-field">
                <label htmlFor="bk-city">
                  Delivery city <Hint text="Use the city name TCS knows, for example Karachi, Lahore, Islamabad, Rawalpindi, Faisalabad." />
                </label>
                <input id="bk-city" value={form.city} onChange={set("city")} required />
              </div>
              <div className="a-field wide">
                <label htmlFor="bk-address">Delivery address</label>
                <textarea id="bk-address" value={form.address} onChange={set("address")} required rows={2} />
              </div>
              <div className="a-field">
                <label htmlFor="bk-cod">
                  Cash the rider should collect (PKR) <Hint text="For cash-on-delivery orders this is the full total. If the customer already paid by bank transfer, put 0." />
                </label>
                <input id="bk-cod" value={form.cod} onChange={(event) => setForm((c) => ({ ...c, cod: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" required />
              </div>
              <div className="a-field">
                <label htmlFor="bk-pieces">Number of pieces</label>
                <input id="bk-pieces" value={form.pieces} onChange={(event) => setForm((c) => ({ ...c, pieces: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" required />
              </div>
              <div className="a-field">
                <label htmlFor="bk-weight">
                  Weight (kg) <Hint text="A guess is fine. TCS needs at least 0.5 kg. One shirt is about 0.5 kg; a shalwar kameez suit is about 1 kg." />
                </label>
                <input id="bk-weight" value={form.weight} onChange={set("weight")} inputMode="decimal" required />
              </div>
              <label className="a-check" style={{ alignSelf: "end", paddingBottom: 10 }}>
                <input type="checkbox" checked={form.fragile} onChange={(event) => setForm((c) => ({ ...c, fragile: event.target.checked }))} />
                <span>Fragile — handle with care</span>
              </label>
              <div className="a-field wide">
                <label htmlFor="bk-remarks">Note for TCS (optional)</label>
                <input id="bk-remarks" value={form.remarks} onChange={set("remarks")} maxLength={400} />
              </div>
            </div>
            {error && <p className="a-error" role="alert">{error}</p>}
            <SubmitRow pending={pending} onCancel={() => setOpen(false)} label="Book parcel" busy="Booking with TCS…" />
          </form>
        </Dialog>
      )}
    </>
  );
}

export function ManualTrackingButton({ orderId, international = false }: { orderId: string; international?: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [courier, setCourier] = useState("DHL");
  const { submit, pending, error } = useSubmit(`/api/admin/orders/${orderId}/courier`, "POST", "Tracking number saved.", () => setOpen(false));
  return (
    <>
      <button type="button" className="a-btn" onClick={() => setOpen(true)}>
        {international ? "Add courier and tracking number" : "I booked it on the TCS website"}
      </button>
      {open && (
        <Dialog title={international ? "Save the courier and tracking number" : "Save the TCS tracking number"} onClose={() => (pending ? undefined : setOpen(false))}>
          <form
            className="a-stack"
            style={{ gap: 14 }}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void submit({ action: "manual", trackingNumber: value, ...(international ? { courierName: courier } : {}) });
            }}
          >
            <p className="a-muted">{international ? "Type the courier you used and the tracking number they gave you. The customer will see them when they track their order." : "Type the consignment (CN) number TCS gave you. The customer will see it when they track their order."}</p>
            {international && (
              <div className="a-field">
                <label htmlFor="mt-courier">Courier</label>
                <input id="mt-courier" value={courier} onChange={(event) => setCourier(event.target.value)} required maxLength={40} placeholder="e.g. DHL, FedEx, TCS International" />
              </div>
            )}
            <div className="a-field">
              <label htmlFor="mt-cn">{international ? "Tracking number" : "TCS tracking number"}</label>
              <input id="mt-cn" value={value} onChange={(event) => setValue(event.target.value)} required placeholder="e.g. 779412326902" inputMode="numeric" />
            </div>
            {error && <p className="a-error" role="alert">{error}</p>}
            <SubmitRow pending={pending} onCancel={() => setOpen(false)} label="Save number" busy="Saving…" />
          </form>
        </Dialog>
      )}
    </>
  );
}

/* --------------------------------- bank receipts ------------------------------- */

export function ProofButtons({ proofId, status }: { proofId: string; status: string }) {
  const toast = useToast();
  const router = useRouter();
  const action = useLockedAction();
  return (
    <div className="a-row">
      <button
        type="button"
        className="a-btn a-btn-sm"
        onClick={async () => {
          const result = await callApi<{ url: string }>(`/api/admin/payment-proofs/${proofId}`, "GET");
          if (result.ok) window.open(result.data.url, "_blank", "noopener,noreferrer");
          else toast(result.error, "bad");
        }}
      >
        <Icon name="eye" size={15} /> Look at the receipt
      </button>
      {status === "pending" && (
        <>
          <ApiButton url={`/api/admin/payment-proofs/${proofId}`} method="PATCH" body={{ status: "approved" }} label="Payment is correct" busyLabel="Saving…" size="sm" variant="primary" success="Payment marked as received." />
          <button
            type="button"
            className="a-btn a-btn-sm a-btn-danger"
            disabled={action.pending}
            onClick={() =>
              action.run(async () => {
                const result = await callApi(`/api/admin/payment-proofs/${proofId}`, "PATCH", { status: "rejected" });
                if (result.ok) {
                  toast("Receipt marked as not correct.", "good");
                  router.refresh();
                } else toast(result.error, "bad");
              })
            }
          >
            Not correct
          </button>
        </>
      )}
    </div>
  );
}

/* --------------------------------- private note -------------------------------- */

export function PrivateNote({ orderId, initial }: { orderId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const { submit, pending } = useSubmit(`/api/admin/orders/${orderId}`, "PATCH", "Note saved.", () => {});
  return (
    <form
      className="a-stack"
      style={{ gap: 10 }}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void submit({ notes: value || null });
      }}
    >
      <label className="sr-only" htmlFor="private-note">
        Private note
      </label>
      <textarea id="private-note" value={value} onChange={(event) => setValue(event.target.value)} rows={3} maxLength={1000} placeholder="Write a reminder for yourself, e.g. “Customer will be home after 5 pm”. The customer never sees this." />
      <div>
        <button className="a-btn a-btn-sm" disabled={pending || value === initial}>
          {pending ? <span className="spinner" aria-hidden="true" /> : null} Save note
        </button>
      </div>
    </form>
  );
}
