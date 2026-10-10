/**
 * The guided labs of the training site (training.nureasmir.com): short, hands-on tasks done in the practice shop. Each task has a
 * plain sentence in English and in Roman Urdu, the admin page to do it on, and a check (see lib/lab-checks.ts) that looks at the
 * practice data to see whether it was really done. Pure data (no database), so the client, the server and the tests can all use it.
 */
export type LabText = { en: string; ur: string };
export type LabStep = { text: LabText; /** The admin page where this is done. */ href: string };
export type Lab = { id: string; title: LabText; goal: LabText; minutes: number; steps: LabStep[] };

export const LABS: Lab[] = [
  {
    id: "add-product",
    title: { en: "Add your first product", ur: "Apna pehla product add karein" },
    goal: { en: "Put a new product on the shop with a price, a size and stock, and make it live.", ur: "Dukaan par naya product lagayein: qeemat, size aur stock ke saath, aur usay live karein." },
    minutes: 10,
    steps: [
      { text: { en: "Open Products and press “Add product”. Give it a name and choose a category, then save.", ur: "Products kholein aur “Add product” dabayein. Naam likhein, category chunein, phir save karein." }, href: "/admin/products/new" },
      { text: { en: "Give it a price above Rs. 0 and add one size with some stock.", ur: "Qeemat Rs. 0 se zyada rakhein aur ek size aur kuch stock add karein." }, href: "/admin/products" },
      { text: { en: "Make it live: set the product to Published and save.", ur: "Isay live karein: product ko Published karein aur save karein." }, href: "/admin/products" },
    ],
  },
  {
    id: "confirm-order",
    title: { en: "Take an order from new to packed", ur: "Order ko new se packed tak le jayein" },
    goal: { en: "Confirm a new order, pack it, and write down its TCS tracking number.", ur: "Naye order ko confirm karein, pack karein, aur TCS tracking number likhein." },
    minutes: 8,
    steps: [
      { text: { en: "Open Orders, open an order marked “New — please confirm” and press Confirm.", ur: "Orders kholein, “New — please confirm” wala order kholein aur Confirm dabayein." }, href: "/admin/orders" },
      { text: { en: "Move that order forward until it is Packed (or further).", ur: "Us order ko aage barhayein jab tak woh Packed (ya us se aage) na ho jaye." }, href: "/admin/orders" },
      { text: { en: "Type any tracking number for that order and save it. (In the real shop this comes from TCS.)", ur: "Us order ka koi bhi tracking number likhein aur save karein. (Asli dukaan mein yeh TCS se aata hai.)" }, href: "/admin/orders" },
    ],
  },
  {
    id: "cancel-order",
    title: { en: "Cancel an order the right way", ur: "Order sahi tareeqay se cancel karein" },
    goal: { en: "Cancel an order that TCS has not taken yet, and say why.", ur: "Aisa order cancel karein jo TCS ne abhi nahi liya, aur wajah likhein." },
    minutes: 5,
    steps: [
      { text: { en: "Open an order that is New or Confirmed.", ur: "Koi New ya Confirmed order kholein." }, href: "/admin/orders" },
      { text: { en: "Press Cancel, choose a reason, and confirm. The stock goes back on the shelf.", ur: "Cancel dabayein, wajah chunein, aur confirm karein. Stock wapas shelf par chala jata hai." }, href: "/admin/orders" },
    ],
  },
  {
    id: "flash-sale",
    title: { en: "Run a flash sale", ur: "Flash sale chalayein" },
    goal: { en: "Create a sale with a discount, choose what it covers, and switch it on.", ur: "Discount ke saath sale banayein, chunein kya cover hoga, aur isay on karein." },
    minutes: 8,
    steps: [
      { text: { en: "Open Flash sales and create a new sale with a name and a discount above 0.", ur: "Flash sales kholein aur naam aur 0 se zyada discount ke saath nayi sale banayein." }, href: "/admin/flash-sales" },
      { text: { en: "Choose the products it covers (or all products).", ur: "Chunein kin products par lagegi (ya sab products par)." }, href: "/admin/flash-sales" },
      { text: { en: "Make sure it is switched on and has not ended yet.", ur: "Yaqeeni banayein ke yeh on hai aur abhi khatam nahi hui." }, href: "/admin/flash-sales" },
    ],
  },
  {
    id: "discount-code",
    title: { en: "Make a discount code", ur: "Discount code banayein" },
    goal: { en: "Create a code customers can type at checkout.", ur: "Aisa code banayein jo customer checkout par likh sakein." },
    minutes: 6,
    steps: [
      { text: { en: "Open Discount codes and create a new code (for example WELCOME10).", ur: "Discount codes kholein aur naya code banayein (maslan WELCOME10)." }, href: "/admin/coupons" },
      { text: { en: "Give it a value above 0 and keep it switched on.", ur: "Iski value 0 se zyada rakhein aur isay on rakhein." }, href: "/admin/coupons" },
    ],
  },
  {
    id: "answer-faq",
    title: { en: "Answer a customer question", ur: "Customer ke sawal ka jawab likhein" },
    goal: { en: "Add a question and a clear answer to the Questions & answers page.", ur: "Questions & answers page par sawal aur saaf jawab shamil karein." },
    minutes: 5,
    steps: [
      { text: { en: "Open Questions & answers and add a new question.", ur: "Questions & answers kholein aur naya sawal shamil karein." }, href: "/admin/faqs" },
      { text: { en: "Write an answer of at least a full sentence, and keep it switched on.", ur: "Kam az kam poori ek jumle ka jawab likhein aur isay on rakhein." }, href: "/admin/faqs" },
    ],
  },
];

export const labById = (id: string): Lab | undefined => LABS.find((lab) => lab.id === id);
