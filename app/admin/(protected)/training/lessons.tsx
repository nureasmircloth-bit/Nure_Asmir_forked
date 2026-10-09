import type { ReactNode } from "react";
import { estimateSeconds, type Lesson, type Step, type TourState } from "@/lib/training-engine";
import { Badge, Btn, Card, Chip, Field, Grid, Shell, T, Table, Tip } from "./mock";

/**
 * Every lesson, written as plain data: what the narrator says, what the pretend screen shows, and what the cursor does.
 * To add a lesson, add an object to LESSONS – no other file needs to change.
 */

const Photo = ({ navy }: { navy?: boolean }) => <span className={`m-photo${navy ? " navy" : ""}`} />;

/** A full-screen "slide" for the ideas that are not a screen of the admin (Google tips, daily routine…). */
function Slide({ title, points, foot }: { title: string; points: Array<[string, string]>; foot?: string }) {
  return (
    <div style={{ padding: "22px 30px", display: "grid", gap: 12, alignContent: "start", height: "100%", background: "var(--bg)" }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{title}</div>
      <div style={{ display: "grid", gap: 9 }}>
        {points.map(([head, text], i) => (
          <div key={head} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface)" }}>
            <span className="tour-num" style={{ width: 24, height: 24, fontSize: 12 }}>{i + 1}</span>
            <span style={{ fontSize: 13.5 }}><strong>{head}</strong> — {text}</span>
          </div>
        ))}
      </div>
      {foot && <Tip>{foot}</Tip>}
    </div>
  );
}

/* ------------------------------ 1. Find your way around ------------------------------ */
const todo = (s: TourState): ReactNode => (
  <Shell nav="Home" title="Good morning, Owner" intro="Tuesday, 6 October">
    <div style={{ fontWeight: 800, fontSize: 14 }}>To do now</div>
    <Grid cols={4}>
      {[["todo-orders", "3", "New orders to confirm"], ["todo-receipts", "1", "Bank receipts to check"], ["todo-send", "2", "Orders to send with TCS"], ["todo-refunds", "0", "Refunds waiting"]].map(([id, n, label]) => (
        <T key={id} id={id} s={s} as="div" className="a-card" style={{ padding: 10 }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{n === "0" ? "✓" : n}</div>
          <div style={{ fontWeight: 700 }}>{label}</div>
        </T>
      ))}
    </Grid>
  </Shell>
);

const homeNumbers = (s: TourState) => (
  <Shell nav="Home" title="How your shop is doing">
    <div className="a-row" style={{ gap: 6, display: "flex" }}>
      {["Today", "7 days", "30 days", "90 days"].map((label, i) => (
        <Chip key={label} id={["p-today", "p7", "p30", "p90"][i]} s={s} on={(s.period ?? "7") === ["1", "7", "30", "90"][i]}>{label}</Chip>
      ))}
    </div>
    <Grid cols={3}>
      <Card title="Sales"><div style={{ fontSize: 20, fontWeight: 800 }}>{s.period === "90" ? "Rs 1,284,500" : "Rs 214,300"}</div></Card>
      <Card title="Orders"><div style={{ fontSize: 20, fontWeight: 800 }}>{s.period === "90" ? "311" : "52"}</div></Card>
      <Card title="Customers"><div style={{ fontSize: 20, fontWeight: 800 }}>{s.period === "90" ? "247" : "44"}</div></Card>
    </Grid>
    <Tip>Only these numbers change when you pick a period. The page does not reload or jump.</Tip>
  </Shell>
);

/* ------------------------------ 2. Add a product ------------------------------ */
const editor = (s: TourState, extra?: ReactNode) => (
  <Shell nav="Products" title="Add a product">
    {extra ? (
      <div className="a-card" style={{ padding: "6px 12px" }}>
        <strong>1. About the product</strong> <span className="a-muted">· {s.name || "Product name"} · {s.cat || "Category"} · {s.type || "Type"}</span>
      </div>
    ) : (
      <Card title="1. About the product">
        <Grid cols={3}>
          <Field id="f-name" s={s} k="name" label="Product name" placeholder="e.g. Olive Cargo Pants" />
          <Field id="f-cat" s={s} k="cat" label="Category" placeholder="Choose a category" />
          <Field id="f-type" s={s} k="type" label="What is it?" placeholder="e.g. Pants" />
        </Grid>
      </Card>
    )}
    {extra}
  </Shell>
);

const sizesCard = (s: TourState) => (
  <Card title="4. Sizes, prices and stock" right={<span className="a-muted">Quick add: <T id="q-sizes" s={s} className="tf-chip">S M L XL XXL</T></span>}>
    {s.sizes === "5" ? (
      <Table
        head={["Size", "Price (PKR)", "In stock"]}
        rows={["S", "M", "L", "XL", "XXL"].map((size, i) => [size, i === 0 ? <T key="p" id="f-price" s={s} className="tf-input">{s.price ?? "4500"}</T> : s.same === "1" ? s.price : "", i === 0 ? <T key="st" id="f-stock" s={s} className="tf-input">{s.stock ?? "0"}</T> : "0"])}
      />
    ) : (
      <span className="a-muted">Press a quick-add button to get the size rows.</span>
    )}
    {s.sizes === "5" && <T id="b-same" s={s} className="a-btn">Use the first price for every size</T>}
  </Card>
);

/* ------------------------------ lessons ------------------------------ */
const LESSON_DEFS: Array<Omit<Lesson, "minutes">> = [
  {
    id: "around",
    title: "1. Find your way around",
    blurb: "Home, the search bar, the numbers and the little help boxes. Start here.",
    steps: [
      { say: "This is Home. Everything that needs you today is in the “To do now” boxes. A tick means nothing is waiting.", screen: todo, actions: [{ t: "move", to: "todo-orders" }] },
      { say: "Click a box to go straight to those orders – no hunting through menus.", screen: todo, actions: [{ t: "click", on: "todo-orders" }, { t: "move", to: "todo-send" }] },
      {
        say: "Lost something? Press Ctrl and K together (or click the search bar). Type an order number, a customer’s name or the last digits of their phone.",
        screen: (s) => (
          <Shell nav="Home" title="Find anything">
            <Field id="f-search" s={s} k="q" label="Search" placeholder="Order number, name or phone…" wide />
            {s.q && <Card title="Orders"><Table head={["Order", "Customer", "Status"]} rows={[["NA-10482", "Ahmed Raza · 0301 2345678", <Badge key="b" tone="new">Needs you</Badge>]]} /></Card>}
          </Shell>
        ),
        actions: [{ t: "type", into: "f-search", key: "q", text: "0301 234" }],
      },
      { say: "Here is how your shop is doing. Pick Today, 7, 30 or 90 days. Only the numbers change – the page does not reload.", screen: homeNumbers, actions: [{ t: "click", on: "p90", set: { period: "90" } }] },
      {
        say: "See the blue box and the little (?) marks? Every page has them. Hover a (?) and it explains that word in plain language.",
        screen: (s) => (
          <Shell nav="Stock" title="Stock">
            <Tip><strong>How this page works.</strong> “In stock” is what is on your shelf. “Held” is promised to customers who have not received it yet.</Tip>
            <Card title="Price (PKR)"><T id="help-q" s={s} className="a-badge tone-work">?</T> <span className="a-muted">The price the customer pays.</span></Card>
          </Shell>
        ),
        actions: [{ t: "move", to: "help-q" }],
      },
      { say: "Prefer a light screen, a dark one, or bigger writing? The theme button at the top right changes it – and it remembers your choice.", screen: (s) => (<Shell nav="Home" title="Look and size"><Grid cols={3}><Card title="Light"><T id="t-light" s={s} className="tf-chip">Light</T></Card><Card title="Night"><T id="t-night" s={s} className="tf-chip">Night</T></Card><Card title="Bigger writing"><T id="t-big" s={s} className="tf-chip">Larger</T></Card></Grid></Shell>), actions: [{ t: "move", to: "t-light" }, { t: "click", on: "t-big" }] },
    ],
  },
  {
    id: "product",
    title: "2. Add a product",
    blurb: "Name, photos, sizes, price and stock on one page – then see it the way customers will.",
    steps: [
      { say: "Open Products and press “Add product”.", screen: (s) => (<Shell nav="Products" title="Products"><div style={{ display: "flex", justifyContent: "flex-end" }}><Btn id="b-add" s={s} primary>+ Add product</Btn></div><Card><Table head={["Product", "Price", "Stock"]} rows={[["Linen Shirt", "Rs 4,500", "28"], ["Olive Cargo Pants", "Rs 5,200", "14"]]} /></Card></Shell>), actions: [{ t: "click", on: "b-add" }] },
      { say: "Type the name the customer will see, pick the category, and say what it is – for example “Kurta”.", screen: (s) => editor(s), actions: [{ t: "type", into: "f-name", key: "name", text: "Ivory Cotton Kurta" }, { t: "type", into: "f-cat", key: "cat", text: "Kurtas" }, { t: "type", into: "f-type", key: "type", text: "Kurta" }] },
      {
        say: "Type the colour, then add photos. Drag many at once. We make five small, fast sizes automatically – JPG, PNG, WebP, AVIF and GIF all work.",
        screen: (s) => editor(s, (<><Card title="2. Colour"><Field id="f-colour" s={s} k="colour" label="Colour" placeholder="e.g. Ivory" w={220} /></Card><Card title="3. Photos"><div style={{ display: "flex", gap: 8, alignItems: "center" }}><T id="b-photos" s={s} className="a-btn">Drag photos here, or click</T>{s.photos && <><Photo /><Photo /><Photo /></>}</div></Card></>)),
        actions: [{ t: "type", into: "f-colour", key: "colour", text: "Ivory" }, { t: "click", on: "b-photos", set: { photos: "3" } }],
      },
      { say: "Press “S M L XL XXL” to get the size rows, type the price once, then press “Use the first price for every size”.", screen: (s) => editor(s, sizesCard(s)), actions: [{ t: "click", on: "q-sizes", set: { sizes: "5" } }, { t: "type", into: "f-price", key: "price", text: "6500" }, { t: "click", on: "b-same", set: { same: "1" } }] },
      { say: "Type how many you have on the shelf. When it reaches 0, the size shows “Sold out” on your website by itself.", screen: (s) => editor(s, sizesCard({ ...s, sizes: "5", same: "1" })), actions: [{ t: "type", into: "f-stock", key: "stock", text: "8" }] },
      {
        say: "Before saving, press Preview. See the page as it will look on a phone and on a laptop. Nothing is saved yet.",
        screen: (s) => (
          <Shell nav="Products" title="How customers will see it">
            <div className="a-row" style={{ display: "flex", gap: 6 }}><Chip id="pv-phone" s={s} on={s.pv !== "lap"}>Phone</Chip><Chip id="pv-lap" s={s} on={s.pv === "lap"}>Laptop</Chip></div>
            <Card><div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}><Photo /><div style={{ display: "grid", gap: 6 }}><strong style={{ fontSize: 16 }}>Ivory Cotton Kurta</strong><span>Rs 6,500</span><span><Chip on>Ivory</Chip></span><span style={{ display: "flex", gap: 5 }}>{["S", "M", "L", "XL"].map((x) => <Chip key={x}>{x}</Chip>)}</span></div></div></Card>
          </Shell>
        ),
        actions: [{ t: "click", on: "pv-lap", set: { pv: "lap" } }, { t: "click", on: "pv-phone", set: { pv: "ph" } }],
      },
      {
        say: "Scroll down: “Be found on Google”. It shows the words shoppers type, how Google may show your product, and a checklist. Press “Try on Google” beside any phrase to see today’s results.",
        screen: (s) => (
          <Shell nav="Products" title="6. Be found on Google and AI assistants">
            <Card title="How it may look on Google"><div style={{ color: "#1a0dab", fontSize: 15 }}>Ivory Cotton Kurta | Nure Asmir</div><div className="a-muted">Ivory cotton kurta, cut for a relaxed fit…</div></Card>
            <Card title="People ready to buy"><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{["ivory kurta for men", "buy kurta online in pakistan", "kurta price in pakistan"].map((p, i) => <T key={p} id={`kw${i}`} s={s} className="tf-chip">{p} ↗</T>)}</div></Card>
            <Card title="Checklist"><span>✓ The name is clear  ✓ Price is set  <span style={{ color: "var(--work)" }}>• Add 40 words to the description</span></span></Card>
          </Shell>
        ),
        actions: [{ t: "move", to: "kw0" }, { t: "click", on: "kw1" }],
      },
      { say: "Choose “Yes – show it to customers”, then press “Add product”. It is on your website straight away.", screen: (s) => (<Shell nav="Products" title="5. Show it on your website?"><Card><T id="r-yes" s={s} className={`tf-chip${s.shown ? " on" : ""}`}>Yes – show it to customers</T><div style={{ marginTop: 6 }}><Btn id="b-save" s={s} primary>Add product</Btn></div>{s.saved && <Badge tone="done">Product added ✓</Badge>}</Card></Shell>), actions: [{ t: "click", on: "r-yes", set: { shown: "1" } }, { t: "click", on: "b-save", set: { saved: "1" } }] },
    ],
  },
  {
    id: "colours",
    title: "3. Same shirt, another colour",
    blurb: "One product, many colours – customers see colour buttons, and you keep one list.",
    steps: [
      { say: "Open the product that already exists. Your colours are shown as buttons at the top of the colour box.", screen: (s) => (<Shell nav="Products" title="Ivory Cotton Kurta"><Card title="2. Colours"><div style={{ display: "flex", gap: 8 }}><T id="c-ivory" s={s} className="tf-chip on">Ivory · 3 photos</T><T id="b-addcolor" s={s} className="tf-chip">+ Add another colour</T></div></Card></Shell>), actions: [{ t: "click", on: "b-addcolor" }] },
      { say: "Type the new colour. We copy the old sizes and prices, so you only change what is different. Stock starts at 0.", screen: (s) => (<Shell nav="Products" title="Add this product in another colour"><Card><Field id="f-newcolor" s={s} k="nc" label="New colour" placeholder="e.g. Navy" w={240} /><div style={{ display: "flex", gap: 8 }}><Btn id="b-addc" s={s} primary>Add colour</Btn><Btn id="b-cancel" s={s}>Cancel</Btn></div></Card></Shell>), actions: [{ t: "type", into: "f-newcolor", key: "nc", text: "Navy" }, { t: "click", on: "b-addc", set: { colour2: "1" } }] },
      { say: "Navy now has the same five sizes and prices already filled in. Change a price if Navy costs more, and type your Navy stock.", screen: (s) => (<Shell nav="Products" title="Navy · sizes, prices and stock"><Card><Table head={["Size", "Price (PKR)", "In stock"]} rows={["S", "M", "L", "XL", "XXL"].map((x, i) => [x, "6500", i === 0 ? <T key="n" id="f-navystock" s={s} className="tf-input">{s.ns ?? "0"}</T> : "0"])} /></Card></Shell>), actions: [{ t: "type", into: "f-navystock", key: "ns", text: "10" }] },
      { say: "Add the Navy photos. Each colour has its own photos – customers see the right ones when they choose the colour.", screen: (s) => (<Shell nav="Products" title="3. Photos · Navy"><Card><div style={{ display: "flex", gap: 8, alignItems: "center" }}><T id="b-navyphotos" s={s} className="a-btn">Drag photos here, or click</T>{s.np && <><Photo navy /><Photo navy /></>}</div></Card></Shell>), actions: [{ t: "click", on: "b-navyphotos", set: { np: "2" } }] },
      { say: "Press “Save changes”. On your website the product now has Ivory and Navy buttons.", screen: (s) => (<Shell nav="Products" title="Ivory Cotton Kurta"><Card><div style={{ display: "flex", gap: 14 }}>{s.pickNavy ? <Photo navy /> : <Photo />}<div style={{ display: "grid", gap: 6 }}><strong>Colour: {s.pickNavy ? "Navy" : "Ivory"}</strong><div style={{ display: "flex", gap: 6 }}><Chip id="cb-ivory" s={s} on={!s.pickNavy}>Ivory</Chip><Chip id="cb-navy" s={s} on={!!s.pickNavy}>Navy</Chip></div></div></div></Card><Btn id="b-savech" s={s} primary>Save changes</Btn></Shell>), actions: [{ t: "click", on: "b-savech" }, { t: "click", on: "cb-navy", set: { pickNavy: "1" } }] },
      { say: "In Stock you will see ONE line for this kurta with the total, and Ivory and Navy sizes inside when you open it.", screen: (s) => (<Shell nav="Stock" title="Stock"><Card><Table head={["Product", "Colours", "In stock"]} rows={[[<T key="r" id="row-kurta" s={s}>Ivory Cotton Kurta</T>, "2", "18"]]} /></Card></Shell>), actions: [{ t: "click", on: "row-kurta" }] },
    ],
  },
  {
    id: "excel",
    title: "4. Add many products with Excel",
    blurb: "Fill a sheet like a table. Rows with the same name become one product with colours.",
    steps: [
      { say: "Products → “Add many at once”. Press “Download the Excel sheet”. It opens in Excel or Google Sheets.", screen: (s) => (<Shell nav="Products" title="Add many products at once"><Card><Btn id="b-dl" s={s} primary>Download the Excel sheet</Btn><span className="a-muted">Fill it like a table, then come back.</span></Card></Shell>), actions: [{ t: "click", on: "b-dl" }] },
      { say: "One row for every size. Type the same product name on each row. The same shirt in another colour? Same name, different colour – we join them for you.", screen: (s) => (<div style={{ padding: 16 }}><Card title="products.xlsx"><Table head={["Product name", "Category", "Colour", "Size", "Price", "Stock"]} rows={[["Linen Shirt", "Shirts", "Sand", "M", "4500", "6"], ["Linen Shirt", "Shirts", "Sand", "L", "4500", "5"], [<T key="n" id="row-navy" s={s}>Linen Shirt</T>, "Shirts", "Navy", "M", "4500", "4"]]} /></Card><Tip>Grey boxes in the sheet explain each column. The first row is the title row – keep it.</Tip></div>), actions: [{ t: "move", to: "row-navy" }] },
      { say: "Save the file and drop it in the box. We read it and tell you in plain words if anything is wrong, with the row number.", screen: (s) => (<Shell nav="Products" title="Check your products"><Card><T id="drop" s={s} as="div" className="a-btn">Drop your sheet here</T>{s.up && <><Badge tone="done">1 product · 2 colours · 3 sizes ready</Badge></>}</Card></Shell>), actions: [{ t: "click", on: "drop", set: { up: "1" } }] },
      { say: "Add the pictures. Name them in the sheet’s “Photo file names” column, then drag all the pictures in together.", screen: (s) => (<Shell nav="Products" title="Add the pictures"><Card><T id="b-pics" s={s} className="a-btn">Choose pictures</T>{s.pics && <span style={{ display: "flex", gap: 6 }}><Photo /><Photo navy /></span>}</Card></Shell>), actions: [{ t: "click", on: "b-pics", set: { pics: "1" } }] },
      { say: "Press “Add my products”. Products without a picture are saved as Hidden so customers never see an empty page.", screen: (s) => (<Shell nav="Products" title="Done"><Card><Btn id="b-go" s={s} primary>Add my products</Btn>{s.fin && <Badge tone="done">Done ✓ Linen Shirt – 2 colours, 3 sizes, 2 photos</Badge>}</Card></Shell>), actions: [{ t: "click", on: "b-go", set: { fin: "1" } }] },
    ],
  },
  {
    id: "stock",
    title: "5. Keep stock and prices right",
    blurb: "One list for every product, by category. Open a product to change a size.",
    steps: [
      { say: "Stock shows one line per product with the total. Use the category buttons – press “Shirts” to see only shirts.", screen: (s) => (<Shell nav="Stock" title="Stock"><div style={{ display: "flex", gap: 6 }}><Chip id="cat-all" s={s} on={s.cat !== "shirts"}>All categories 42</Chip><Chip id="cat-shirts" s={s} on={s.cat === "shirts"}>Shirts 14</Chip><Chip>Kurtas 9</Chip><Chip>Pants 11</Chip></div><Card><Table head={["Product", "Colours", "In stock"]} rows={s.cat === "shirts" ? [["Linen Shirt", "2", "15"], ["Oxford Shirt", "1", "22"]] : [["Linen Shirt", "2", "15"], ["Ivory Cotton Kurta", "2", "18"], ["Olive Cargo Pants", "1", "14"]]} /></Card></Shell>), actions: [{ t: "click", on: "cat-shirts", set: { cat: "shirts" } }] },
      { say: "Press a product line (or “Sizes”) to open it. You see each colour, and the number of every size.", screen: (s) => (<Shell nav="Stock" title="Linen Shirt"><Card title="Sand · 11 in stock"><Table head={["Size", "Price", "In stock", ""]} rows={[["M", "4500", <T key="m" id="f-stockm" s={s} className="tf-input">{s.sm ?? "6"}</T>, s.sm ? <T key="sv" id="b-savem" s={s} className="a-btn a-btn-primary">Save</T> : ""], ["L", "4500", "5", ""]]} /></Card></Shell>), actions: [{ t: "type", into: "f-stockm", key: "sm", text: "12" }, { t: "click", on: "b-savem", set: { savedm: "1" } }] },
      { say: "Change the number, and a Save button appears on that row only. Press it – customers see the new number straight away.", screen: () => (<Shell nav="Stock" title="Saved"><Card><Badge tone="done">Linen Shirt Sand M saved ✓</Badge><div className="a-muted">When a size reaches 0 it shows “Sold out” by itself.</div></Card></Shell>), actions: [{ t: "wait", ms: 400 }] },
      { say: "“Running low” and “Sold out” show what to reorder. You also get an alert on your computer when something runs low.", screen: (s) => (<Shell nav="Stock" title="Stock"><div style={{ display: "flex", gap: 6 }}><Chip>Everything</Chip><Chip id="tab-low" s={s} on>Running low 5</Chip><Chip>Sold out 2</Chip></div><Card><Table head={["Product", "Size", "Left"]} rows={[["Oxford Shirt", "XL", <Badge key="b" tone="new">2 left</Badge>], ["Olive Cargo Pants", "32", <Badge key="c" tone="new">1 left</Badge>]]} /></Card></Shell>), actions: [{ t: "click", on: "tab-low" }] },
      { say: "Changing prices for many products? “Update with Excel” gives you a sheet of every price and stock. Change the numbers, upload, done.", screen: (s) => (<Shell nav="Stock" title="Stock"><div style={{ display: "flex", justifyContent: "flex-end" }}><Btn id="b-xl" s={s}>Update with Excel</Btn></div></Shell>), actions: [{ t: "click", on: "b-xl" }] },
    ],
  },
  {
    id: "orders",
    title: "6. An order, start to finish",
    blurb: "Confirm → pack → book TCS → on its way → delivered. Plain steps, one button each.",
    steps: [
      { say: "A new order alert pops up on your computer. Open Orders: the “Needs you” tab shows new orders.", screen: (s) => (<Shell nav="Orders" title="Orders"><div style={{ display: "flex", gap: 6 }}><Chip id="tab-needs" s={s} on>Needs you 3</Chip><Chip>To pack &amp; send 2</Chip><Chip>With TCS 6</Chip></div><Card><Table head={["Order", "Customer", "Total", "Status"]} rows={[[<T key="o" id="row-order" s={s}>NA-10482</T>, "Ahmed Raza · Lahore", "Rs 6,500", <Badge key="b" tone="new">Needs you</Badge>]]} /></Card></Shell>), actions: [{ t: "click", on: "tab-needs" }, { t: "click", on: "row-order" }] },
      { say: "Call or WhatsApp the customer to confirm the address. Then press “Confirm”.", screen: (s) => (<Shell nav="Orders" title="Order NA-10482"><Card><div>Ahmed Raza · 0301 2345678</div><div className="a-muted">House 12, Gulberg III, Lahore · Cash on delivery</div><div style={{ display: "flex", gap: 8 }}><Btn id="b-confirm" s={s} primary>Confirm</Btn><Btn id="b-cancelo" s={s}>Cancel order</Btn></div>{s.conf && <Badge tone="work">Confirmed ✓</Badge>}</Card></Shell>), actions: [{ t: "click", on: "b-confirm", set: { conf: "1" } }] },
      { say: "Pack it, then press “Book TCS”. You get the tracking number and the label to print. (Booking many orders? Tick them all and book at once.)", screen: (s) => (<Shell nav="Orders" title="To pack &amp; send"><Card><Table head={["Order", "City", ""]} rows={[["NA-10482", "Lahore", <T key="bk" id="b-book" s={s} className="a-btn a-btn-primary">Book TCS</T>]]} />{s.booked && <Badge tone="ship">Tracking 770123456789 · print label</Badge>}</Card></Shell>), actions: [{ t: "click", on: "b-book", set: { booked: "1" } }] },
      { say: "When TCS collects the parcel, the order moves to “With TCS” by itself. From now on it can no longer be cancelled.", screen: () => (<Shell nav="Orders" title="Order NA-10482"><Card><Badge tone="ship">With TCS</Badge><div className="a-muted">TCS has the parcel – the Cancel button is switched off and explains why.</div><span className="a-btn" style={{ opacity: 0.45 }}>Cancel order</span></Card></Shell>), actions: [{ t: "wait", ms: 500 }] },
      { say: "When TCS delivers it, the order turns Delivered, cash-on-delivery is marked paid and the customer is told. You did not have to do anything.", screen: (s) => (<Shell nav="Orders" title="Orders"><Card><Table head={["Order", "Status"]} rows={[["NA-10482", <T key="d" id="st-del" s={s} className="a-badge tone-done">Delivered ✓</T>]]} /></Card></Shell>), actions: [{ t: "move", to: "st-del" }] },
    ],
  },
  {
    id: "refunds",
    title: "7. Cancelling and refunds",
    blurb: "Cancel until TCS has the parcel. After delivery, customers ask – you decide.",
    steps: [
      { say: "To cancel, open the order and press “Cancel order”. Choose the reason – it also puts the stock back on the shelf.", screen: (s) => (<Shell nav="Orders" title="Cancel this order?"><Card><Field id="f-reason" s={s} k="reason" label="Why are you cancelling?" placeholder="Choose a reason" w={300} /><Btn id="b-yescancel" s={s} primary>Cancel the order</Btn></Card></Shell>), actions: [{ t: "type", into: "f-reason", key: "reason", text: "Customer asked" }, { t: "click", on: "b-yescancel" }] },
      { say: "If the customer had already paid, a refund is opened for you automatically, so nobody’s money is forgotten.", screen: () => (<Shell nav="Refunds" title="Refunds"><Card><Table head={["Order", "Amount", "Why", "Status"]} rows={[["NA-10477", "Rs 6,500", "Cancelled after payment", <Badge key="b" tone="new">Waiting</Badge>]]} /></Card></Shell>), actions: [{ t: "wait", ms: 300 }] },
      { say: "After delivery, a customer can ask for a refund from the Track-your-order page within your refund days. You see their reason and photos.", screen: (s) => (<Shell nav="Refunds" title="Refund request NA-10451"><Card><div>“The size was wrong.” · 2 photos</div><div style={{ display: "flex", gap: 8 }}><Btn id="b-approve" s={s} primary>Approve</Btn><Btn id="b-decline" s={s}>Decline with a reason</Btn></div></Card></Shell>), actions: [{ t: "click", on: "b-approve" }] },
      { say: "Send the money (bank transfer or JazzCash), then press “Mark refunded”. The customer is told, and the order shows Refunded.", screen: (s) => (<Shell nav="Refunds" title="Refund request NA-10451"><Card><Badge tone="work">Approved</Badge><Btn id="b-refunded" s={s} primary>Mark refunded</Btn>{s.rf && <Badge tone="done">Refunded ✓</Badge>}</Card></Shell>), actions: [{ t: "click", on: "b-refunded", set: { rf: "1" } }] },
    ],
  },
  {
    id: "website",
    title: "8. Your website and your shops",
    blurb: "Change the pictures customers see, and list every shop with a map pin.",
    steps: [
      { say: "Website pictures: pick a place (the big banner, the share picture, category cards) and choose a new picture. It changes on the website within a minute.", screen: (s) => (<Shell nav="Website pictures" title="Website pictures"><Grid cols={3}><Card title="Home banner"><Photo /><Btn id="b-change" s={s}>Change picture</Btn></Card><Card title="Share picture"><Photo navy /></Card><Card title="Category cards"><Photo /></Card></Grid></Shell>), actions: [{ t: "click", on: "b-change" }] },
      { say: "Shop locations: press “Add a shop”. Start typing the address and pick the right line – we wait until you stop typing before searching.", screen: (s) => (<Shell nav="Shop locations" title="Add a shop"><Card><Field id="f-addr" s={s} k="addr" label="Find the address" placeholder="Type a street, area or building…" wide />{s.addr && <T id="sugg" s={s} as="div" className="a-card" style={{ padding: 8 }}>Park Lane Tower, Mall of Lahore, Tufail Road, Lahore</T>}</Card></Shell>), actions: [{ t: "type", into: "f-addr", key: "addr", text: "Park Lane Tower" }, { t: "click", on: "sugg" }] },
      { say: "Add the shop name, phone and opening hours, and press “Save shop”. It appears in the website footer, on the Contact page and on Google as a local shop.", screen: (s) => (<Shell nav="Shop locations" title="Shop locations"><Card><Table head={["Shop", "Address", ""]} rows={[["Nure Asmir – Mall of Lahore", "13-F & 13-G, Park Lane Tower, Lahore", <Badge key="m" tone="done">Main shop</Badge>]]} /><Btn id="b-saveshop" s={s} primary>Save shop</Btn></Card></Shell>), actions: [{ t: "click", on: "b-saveshop" }] },
      { say: "Delivery charges: one row for each price – type the cities it covers, the price and the days it takes. Customers see this at checkout.", screen: (s) => (<Shell nav="Delivery charges" title="Delivery charges"><Card><Table head={["Area", "Cities", "Price", "Days"]} rows={[["Punjab", "Lahore, Faisalabad…", "Rs 250", "2–3"], [<T key="z" id="row-zone" s={s}>Sindh</T>, "Karachi…", "Rs 250", "2–4"]]} /></Card></Shell>), actions: [{ t: "move", to: "row-zone" }] },
    ],
  },
  {
    id: "sales",
    title: "9. Sales and discount codes",
    blurb: "Run a flash sale for a few days, or give a code to a customer.",
    steps: [
      { say: "Flash sales: press “New sale”, give it a name, the discount and when it starts and ends. Prices on the website drop automatically and return by themselves.", screen: (s) => (<Shell nav="Flash sales" title="New flash sale"><Card><Grid cols={3}><Field id="f-sale" s={s} k="sale" label="Name" placeholder="e.g. Eid sale" /><Field id="f-pct" s={s} k="pct" label="Discount %" placeholder="10" /><Field id="f-ends" s={s} k="ends" label="Ends" placeholder="Pick a date" /></Grid><Btn id="b-start" s={s} primary>Save sale</Btn></Card></Shell>), actions: [{ t: "type", into: "f-sale", key: "sale", text: "Eid sale" }, { t: "type", into: "f-pct", key: "pct", text: "15" }, { t: "click", on: "b-start" }] },
      { say: "People who saved the item to their wishlist get an alert when the sale starts – the best advertising is free.", screen: () => (<Shell nav="Flash sales" title="Eid sale – live"><Card><Badge tone="done">Live now ✓</Badge><div className="a-muted">14 shoppers told · ends Friday 11 pm</div></Card></Shell>), actions: [{ t: "wait", ms: 300 }] },
      { say: "Discount codes: type a code like EID10, the amount and the last day. Share it on Instagram or WhatsApp. Customers type it at checkout.", screen: (s) => (<Shell nav="Discount codes" title="Discount codes"><Card><Grid cols={3}><Field id="f-code" s={s} k="code" label="Code" placeholder="EID10" /><Field id="f-off" s={s} k="off" label="Off" placeholder="10%" /><Field id="f-last" s={s} k="last" label="Last day" placeholder="Pick a date" /></Grid><Btn id="b-code" s={s} primary>Save code</Btn></Card></Shell>), actions: [{ t: "type", into: "f-code", key: "code", text: "EID10" }, { t: "type", into: "f-off", key: "off", text: "10%" }, { t: "click", on: "b-code" }] },
    ],
  },
  {
    id: "settings",
    title: "10. Settings, safety and cleaning up",
    blurb: "What to set once, and the few advanced choices you can safely ignore.",
    steps: [
      { say: "Settings holds your phone, WhatsApp, social links, TCS pickup address, bank details and refund days. Change, then press “Save settings”.", screen: (s) => (<Shell nav="Settings" title="Settings"><Card title="Your shop and how customers reach you"><Grid cols={2}><Field id="f-phone" s={s} k="ph" label="Phone number" placeholder="+92 311 6111963" /><Field id="f-wa" s={s} k="wa" label="WhatsApp link" placeholder="https://wa.me/…" /></Grid></Card><Btn id="b-ss" s={s} primary>Save settings</Btn></Shell>), actions: [{ t: "type", into: "f-phone", key: "ph", text: "+92 311 6111963" }, { t: "click", on: "b-ss" }] },
      { say: "Turn on order alerts on every computer you use: bottom-left, “Turn on order alerts”, then Allow. You will hear about new orders, receipts, refunds and low stock.", screen: (s) => (<Shell nav="Home" title="Order alerts"><Card><Btn id="b-alerts" s={s}>Turn on order alerts</Btn>{s.al && <Badge tone="done">On for this computer ✓</Badge>}</Card></Shell>), actions: [{ t: "click", on: "b-alerts", set: { al: "1" } }] },
      { say: "“Advanced” is closed on purpose – most shops never touch it. One choice lives here: hide sold-out products after this many days (0 keeps them forever).", screen: (s) => (<Shell nav="Settings" title="Advanced"><Card><Field id="f-days" s={s} k="days" label="Hide sold-out products after (days)" placeholder="90" w={300} /><div className="a-muted">Nothing is deleted. Show it again any time you restock.</div></Card></Shell>), actions: [{ t: "type", into: "f-days", key: "days", text: "90" }] },
      { say: "Old sold-out photos can be “made smaller” in the same place. They stay for your records but free space for new products.", screen: (s) => (<Shell nav="Settings" title="Advanced"><Card><Btn id="b-shrink" s={s} primary>Make them smaller</Btn>{s.sh && <Badge tone="done">25 pictures smaller · 18 MB freed ✓</Badge>}</Card></Shell>), actions: [{ t: "click", on: "b-shrink", set: { sh: "1" } }] },
      { say: "Last: keep your password private, log out on shared computers (bottom-left), and never share the page address with the password.", screen: (s) => (<Shell nav="Home" title="Stay safe"><Card><Btn id="b-logout" s={s}>Log out</Btn></Card></Shell>), actions: [{ t: "move", to: "b-logout" }] },
    ],
  },
  {
    id: "google",
    title: "11. Be found on Google",
    blurb: "A new shop grows by being found. What to do in the first months – step by step.",
    steps: [
      { say: "Every product page already carries what Google and AI assistants need: name, price, stock, colours, photos, your shop addresses. Your job is to feed it good words.", screen: () => <Slide title="What the website does for you" points={[["Sitemap and robots", "Google is told about every page automatically."], ["Product data", "Price, stock, colours and photos are sent in the form Google reads."], ["Shop addresses", "Each shop you add becomes a local business for maps."], ["AI summary", "An /llms.txt page explains your shop to AI assistants."]]} />, actions: [{ t: "wait", ms: 300 }] },
      { say: "Name products the way people search: “Ivory Cotton Kurta for Men”, not “Style 204”. Use the phrases in “Be found on Google” inside the description, in natural sentences.", screen: (s) => (<Shell nav="Products" title="Words that bring buyers"><Card><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{["kurta for men", "kurta price in pakistan", "kurta in lahore", "kurta for eid"].map((p, i) => <T key={p} id={`w${i}`} s={s} className="tf-chip">{p}</T>)}</div></Card></Shell>), actions: [{ t: "move", to: "w0" }, { t: "move", to: "w2" }] },
      { say: "Prove the website is yours to Google and Bing: Settings → Advanced, paste the code from Search Console, then press Verify there. Then send the sitemap: nureasmir.com/sitemap.xml.", screen: (s) => (<Shell nav="Settings" title="Advanced"><Card><Field id="f-gsc" s={s} k="gsc" label="Google Search Console code" placeholder="Paste the code from Google" wide /></Card></Shell>), actions: [{ t: "type", into: "f-gsc", key: "gsc", text: "AbC123-xYz_verify" }] },
      { say: "Create a free Google Business Profile for the Mall of Lahore shop with the SAME name, address and phone as on the website. This is what shows you on Google Maps and “near me”.", screen: () => <Slide title="Google Business Profile" points={[["Same details everywhere", "Name, address and phone must match the website and Facebook exactly."], ["Add photos", "Shop front, inside, and your best products."], ["Opening hours", "Keep them correct – even on Eid."], ["Ask for reviews", "Send happy customers the review link on WhatsApp."]]} foot="Reviews are the strongest local signal a new shop can earn. Aim for 20 honest reviews in the first two months." />, actions: [{ t: "wait", ms: 300 }] },
      { say: "Make your name known everywhere: link the website from Instagram, Facebook and TikTok bios, WhatsApp Business, your TCS and bank pages, and Pakistani shop directories.", screen: () => <Slide title="Links that build trust" points={[["Social bios", "Put nureasmir.com in every profile."], ["Local listings", "Add the shop to Google Maps, Bing Places and Apple Maps."], ["Friends of the brand", "Ask fashion bloggers and local pages to link to a product they wore."], ["Be consistent", "One website address. Never switch domains once it is growing."]]} />, actions: [{ t: "wait", ms: 300 }] },
      { say: "Then be patient and steady: add new products often, keep descriptions honest, and keep the website fast. Domain age counts – a calm, regular shop beats a flashy one.", screen: () => <Slide title="Every week" points={[["Add or refresh 3–5 products", "Fresh pages give Google reasons to come back."], ["Answer messages quickly", "Fast replies turn browsers into buyers."], ["Check Search Console monthly", "See which phrases bring people, and write more about those."], ["Post your best photo", "Instagram and TikTok bring the first visitors."]]} />, actions: [{ t: "wait", ms: 300 }] },
    ],
  },
  {
    id: "messages",
    title: "12. Write to your shoppers",
    blurb: "A notification on their phone (free), an email to one customer, or one to your whole list.",
    steps: [
      {
        say: "Open Messages (under Grow). The Notification tab sends a short message to the phones of shoppers who allowed notifications. It is free and has no limit.",
        screen: (s) => (
          <Shell nav="Messages" title="Messages" intro="Write to your shoppers: a notification on their phone, or an email.">
            <div style={{ display: "flex", gap: 8 }}>
              <Chip id="tab-push" s={s} on>Notification</Chip>
              <Chip id="tab-mail" s={s}>Email</Chip>
            </div>
          </Shell>
        ),
        actions: [{ t: "move", to: "tab-push" }],
      },
      {
        say: "Write a short title and a message. The grey box on the right shows exactly how it will look on a phone. Keep it to one idea: “Eid sale starts tonight”.",
        screen: (s) => (
          <Shell nav="Messages" title="Notification to shoppers">
            <Grid cols={2}>
              <Card>
                <Field id="n-title" s={s} k="ntitle" label="Title" placeholder="Eid sale starts tonight" wide />
                <Field id="n-body" s={s} k="nbody" label="Message" placeholder="Up to 30% off on kameez shalwar until Sunday." wide />
              </Card>
              <Card title="How it looks on a phone">
                <div className="a-card" style={{ padding: 10 }}>
                  <strong>{s.ntitle || "Your title"}</strong>
                  <div className="a-muted">{s.nbody || "Your message appears here."}</div>
                </div>
              </Card>
            </Grid>
          </Shell>
        ),
        actions: [{ t: "type", into: "n-title", key: "ntitle", text: "Eid sale starts tonight" }, { t: "type", into: "n-body", key: "nbody", text: "Up to 30% off on kameez shalwar until Sunday." }],
      },
      {
        say: "Choose who gets it. Always send to “My own devices” first as a test – you see it arrive on your own phone. Then send to the people who asked for sale alerts.",
        screen: (s) => (
          <Shell nav="Messages" title="Who gets it">
            <Card>
              <T id="aud-sales" s={s} as="div">◉ People who asked for sale alerts · 120 phones</T>
              <T id="aud-all" s={s} as="div">○ Everyone with notifications on · 188 phones (use sparingly)</T>
              <T id="aud-test" s={s} as="div">○ Only my own devices (a test)</T>
              <Btn id="b-test" s={s}>Send a test</Btn>
            </Card>
          </Shell>
        ),
        actions: [{ t: "click", on: "aud-test" }, { t: "click", on: "b-test", set: { tested: "1" } }],
      },
      {
        say: "Press “Send now” and confirm. A notification cannot be taken back, so the page asks once. You can see what was sent, and how many phones it reached, in “Sent recently”.",
        screen: (s) => (
          <Shell nav="Messages" title="Sent recently">
            <Card>
              <Btn id="b-send" s={s} primary>Send now</Btn>
              <Table head={["When", "Kind", "Message", "Reached"]} rows={[["Just now", "Notification", "Eid sale starts tonight", s.sent ? "118 of 120" : "—"]]} />
            </Card>
          </Shell>
        ),
        actions: [{ t: "click", on: "b-send", set: { sent: "1" } }],
      },
      {
        say: "The Email tab writes to one customer – type their order number, press Find, and start from a ready-made reply (thanks, please confirm, size help, delay, out of stock). No email address? Reply on WhatsApp instead with one button.",
        screen: (s) => (
          <Shell nav="Messages" title="Email">
            <Card>
              <Field id="m-order" s={s} k="order" label="Order number" placeholder="NA-10234" w={260} />
              <Btn id="m-find" s={s}>Find</Btn>
              {s.found && <span className="a-muted">Ahmed Raza · 0301 1234567 · no email</span>}
              <Btn id="m-wa" s={s}>Reply on WhatsApp instead</Btn>
            </Card>
          </Shell>
        ),
        actions: [{ t: "type", into: "m-order", key: "order", text: "NA-10234" }, { t: "click", on: "m-find", set: { found: "1" } }, { t: "move", to: "m-wa" }],
      },
      {
        say: "To write to your whole email list, choose “Everyone on my email list”. Every email carries an unsubscribe link, and the page tells you how many free emails are left today before it lets you send.",
        screen: (s) => (
          <Shell nav="Messages" title="Email to everyone">
            <Card>
              <T id="list-all" s={s} as="div">◉ Everyone on my email list · 64 people</T>
              <Badge tone="done">About 236 free emails left today</Badge>
              <Tip>Notifications and email on this page are for YOUR messages. Orders still send their own emails and alerts by themselves.</Tip>
            </Card>
          </Shell>
        ),
        actions: [{ t: "click", on: "list-all" }],
      },
      {
        say: "You also get alerts: a new order, a payment receipt, a refund, low stock, and now “TCS booked” with the tracking number. Turn on order alerts on every computer you use.",
        screen: () => <Slide title="What pings you" points={[["New order", "Name, amount and payment method."], ["TCS booked", "Which order and its tracking number – even when a helper booked it."], ["Delivered or returned", "When TCS tells us."], ["Receipts, refunds, low stock", "So nothing waits."]]} />,
        actions: [{ t: "wait", ms: 300 }],
      },
    ],
  },
  {
    id: "words",
    title: "13. Your website’s words and top bar",
    blurb: "Edit the Our story page, make the top bar scroll, and know how long a change takes to show.",
    steps: [
      {
        say: "Our story page (Your website): change the big heading and the text. Leave an empty line between paragraphs. Start a line with > to make it the large quote.",
        screen: (s) => (
          <Shell nav="Our story page" title="Our story page">
            <Grid cols={2}>
              <Card>
                <Field id="s-head" s={s} k="shead" label="Big heading" placeholder="Tradition in a modern form." wide />
                <Field id="s-text" s={s} k="stext" label="Text" placeholder="Nure Asmir is a men’s wear label from Pakistan…" wide />
              </Card>
              <Card title="How it will look">
                <h3 style={{ margin: 0 }}>{s.shead || "Tradition in a modern form."}</h3>
                <div className="a-muted">{s.stext || "Nure Asmir is a men’s wear label from Pakistan…"}</div>
              </Card>
            </Grid>
          </Shell>
        ),
        actions: [{ t: "type", into: "s-head", key: "shead", text: "Made in Pakistan, made to last." }, { t: "type", into: "s-text", key: "stext", text: "We started with one shirt and one idea." }],
      },
      {
        say: "Press Save. “Go back to the original wording” undoes your changes any time. The picture next to the words is changed in Website pictures.",
        screen: (s) => (
          <Shell nav="Our story page" title="Our story page">
            <Card>
              <Btn id="s-save" s={s} primary>Save</Btn>
              <Btn id="s-reset" s={s} quiet>Go back to the original wording</Btn>
            </Card>
          </Shell>
        ),
        actions: [{ t: "click", on: "s-save" }, { t: "move", to: "s-reset" }],
      },
      {
        say: "Settings → Top bar: choose how the lines move – one line at a time, or scrolling to the left or to the right like a news ticker. Touching a scrolling bar pauses it.",
        screen: (s) => (
          <Shell nav="Settings" title="Top bar of your website">
            <Card>
              <T id="mv-one" s={s} as="div">○ One line at a time</T>
              <T id="mv-left" s={s} as="div">○ Scrolling, towards the left</T>
              <T id="mv-right" s={s} as="div">○ Scrolling, towards the right</T>
              <Btn id="mv-prev" s={s}>Preview on phone and computer</Btn>
            </Card>
          </Shell>
        ),
        actions: [{ t: "click", on: "mv-left" }, { t: "click", on: "mv-prev", set: { prev: "1" } }],
      },
      {
        say: "The preview shows the real top bar moving, in a phone frame and a computer frame. Happy? Close it and press “Save settings”.",
        screen: (s) => (
          <Shell nav="Settings" title="Top bar preview">
            <Grid cols={2}>
              <Card title="On a phone"><span className="tf-chip on">CASH ON DELIVERY ALL OVER PAKISTAN •</span></Card>
              <Card title="On a computer"><span className="tf-chip on">CASH ON DELIVERY ALL OVER PAKISTAN • FREE DELIVERY ABOVE RS. 10,000 •</span></Card>
            </Grid>
            <Btn id="mv-save" s={s} primary>Save settings</Btn>
          </Shell>
        ),
        actions: [{ t: "click", on: "mv-save" }],
      },
      {
        say: "After you save anything that shoppers see, a note appears: “Your website will show this in about 3 minutes (around 3:45 pm)”. The website keeps saved copies of its pages near your customers so it opens fast, and they are renewed every few minutes.",
        screen: () => (
          <Shell nav="Settings" title="Saved">
            <Tip><strong>Your website will show this in about 5 minutes (around 3:48 pm).</strong> Shoppers who already have the page open need to refresh it.</Tip>
            <Slide title="How long does a change take?" points={[["Prices, pictures, banners, delivery", "About 3 minutes."], ["Settings, questions, Our story", "About 5 minutes."], ["Check it", "Open your website in a private window after that time."]]} />
          </Shell>
        ),
        actions: [{ t: "wait", ms: 300 }],
      },
      {
        say: "Need more room? The little panel button next to the logo folds the menu into a slim row of icons – hover an icon to read its name. Press it again to bring the menu back. It remembers your choice.",
        screen: (s) => (
          <Shell nav="Home" title="Fold the menu">
            <Card><T id="fold-btn" s={s} className="a-btn">▯ Fold the menu</T><span className="a-muted">Icons stay in the same place; only the words fade away.</span></Card>
          </Shell>
        ),
        actions: [{ t: "click", on: "fold-btn" }],
      },
    ],
  },
  {
    id: "practice",
    title: "14. The practice shop",
    blurb: "The same admin with pretend data – click anything without any risk. Learn by doing.",
    steps: [
      {
        say: "At the bottom of the menu, under “Learn”, is “Practice shop”. Press “Start practice” and wait about 10 seconds while it gets ready. You do not sign in again: you stay signed in.",
        screen: (s) => (
          <Shell nav="Home" title="Practice shop">
            <Card><T id="practice-link" s={s} className="a-btn a-btn-primary">✦ Start practice</T><span className="a-muted">Getting your practice shop ready… 10 seconds</span></Card>
          </Shell>
        ),
        actions: [{ t: "click", on: "practice-link" }],
      },
      {
        say: "An orange strip across the top says PRACTICE SHOP, so you can never mix it up with the real one. Nothing there reaches a customer: no emails, no WhatsApp, no TCS, no notifications.",
        screen: () => (
          <Shell nav="Home" title="Good morning, Owner">
            <div style={{ background: "#f59e0b", color: "#1c1300", padding: "8px 14px", borderRadius: 8, fontWeight: 700 }}>PRACTICE SHOP — nothing here is real · 1,438 of 1,500 clicks left today</div>
          </Shell>
        ),
        actions: [{ t: "wait", ms: 300 }],
      },
      {
        say: "You get a fixed number of clicks each day, and the strip counts them down. There are also small limits on how many products or orders you can add, and on storage (1 MB), so it stays tidy. It starts fresh the next day.",
        screen: () => <Slide title="What is limited" points={[["Clicks per day", "1,500 page views and button presses. Pictures and signing in are free."], ["Products", "Up to 25 at the same time."], ["Orders", "Up to 60 at the same time."], ["Other things", "A few discount codes, flash sales, questions and shops."]]} foot="If you reach a limit the page tells you in plain words. Nothing breaks." />,
        actions: [{ t: "wait", ms: 300 }],
      },
      {
        say: "Made a mess? Press “Start again” in the orange strip. Every product, order and setting goes back to how it was at the beginning. When you are done, press “Leave practice” to go back to your real shop.",
        screen: (s) => (
          <Shell nav="Home" title="Start again">
            <Card><T id="sa-btn" s={s} className="a-btn">Start again</T>{s.sa && <Badge tone="done">Back to the starting practice data ✓</Badge>}</Card>
          </Shell>
        ),
        actions: [{ t: "click", on: "sa-btn", set: { sa: "1" } }],
      },
      {
        say: "Try these, in order: add a product with sizes; confirm an order and add a tracking number; cancel one; make a flash sale; write a notification; edit the Our story page. Repeat until it feels easy.",
        screen: () => <Slide title="Your practice list" points={[["Add a product", "Name, sizes, price, stock – then Preview."], ["Process an order", "Confirm → pack → add the tracking number."], ["Cancel and refund", "See what happens to stock."], ["Run a flash sale", "Set the dates and watch the prices."], ["Write a message", "Preview first, then send the test."]]} />,
        actions: [{ t: "wait", ms: 300 }],
      },
    ],
  },
];

export const LESSONS: Lesson[] = LESSON_DEFS.map((lesson) => ({ ...lesson, minutes: Math.max(1, Math.round(estimateSeconds(lesson.steps as Step[]) / 60)) }));
