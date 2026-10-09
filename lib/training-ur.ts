/**
 * Roman Urdu text for the Training section (the screens themselves stay in English, because the real admin is in English – the owner
 * learns the words they will actually see on the buttons). One entry per lesson, with one line per step, in the same order as
 * the lessons in app/admin/(protected)/training/lessons.tsx. A browser test checks that the step counts match.
 */
export type LessonText = { title: string; blurb: string; steps: string[] };

export const UR: Record<string, LessonText> = {
  around: {
    title: "1. Apna raasta jaanein",
    blurb: "Home, search bar, numbers aur choti madad wali boxes. Yahin se shuru karein.",
    steps: [
      "Ye Home hai. Aaj jo kuch aap ka intezaar kar raha hai wo “To do now” ke dibbon mein hai. Tick ka matlab hai kuch baaki nahi.",
      "Kisi dibbe par click karein aur seedha un orders par pahunch jayein – menu mein dhoondne ki zaroorat nahi.",
      "Kuch dhoondna hai? Ctrl aur K ek saath dabayein (ya search bar par click karein). Order number, customer ka naam ya phone ke aakhri hindsay likhein.",
      "Ye hai aap ki dukaan ka haal. Aaj, 7, 30 ya 90 din chunein. Sirf ye numbers badalte hain – page dobara load nahi hota.",
      "Neeli box aur chote (?) nishaan dekh rahe hain? Har page par hote hain. (?) par mouse le jayein to wo lafz aasaan zubaan mein samjha dega.",
      "Roshan screen, andheri screen ya bara likha hua chahiye? Upar daayein taraf theme ka button badal deta hai – aur aap ki pasand yaad rakhta hai.",
    ],
  },
  product: {
    title: "2. Product add karein",
    blurb: "Naam, photos, sizes, qeemat aur stock ek hi page par – phir dekhein customer ko kaisa nazar aayega.",
    steps: [
      "Products kholein aur “Add product” dabayein.",
      "Wo naam likhein jo customer dekhega, category chunein, aur batayein ye kya hai – masalan “Kurta”.",
      "Rang likhein, phir photos add karein. Ek saath bohat si kheench kar daal dein. Hum khud paanch chote tez sizes bana lete hain – JPG, PNG, WebP, AVIF aur GIF sab chalte hain.",
      "“S M L XL XXL” dabayein taake size ki lines aa jayen, qeemat ek baar likhein, phir “Use the first price for every size” dabayein.",
      "Shelf par kitne hain wo likhein. Jab 0 ho jaye to website par size khud “Sold out” dikhane lagta hai.",
      "Save se pehle Preview dabayein. Dekhein ke phone aur laptop par customer ko kaisa nazar aayega. Abhi kuch save nahi hota.",
      "Neeche jayein: “Be found on Google”. Ye wo alfaaz dikhata hai jo log search karte hain, Google par aap ka product kaisa dikhega, aur ek checklist. Kisi phrase ke saath “Try on Google” dabayein to aaj ke nataij dekh sakte hain.",
      "“Yes – show it to customers” chunein, phir “Add product” dabayein. Product foran website par aa jata hai.",
    ],
  },
  colours: {
    title: "3. Wohi shirt, doosra rang",
    blurb: "Ek product, kai rang – customer ko rang ke buttons nazar aate hain, aur aap ki list ek hi rehti hai.",
    steps: [
      "Jo product pehle se hai wo kholein. Aap ke rang colour box ke upar buttons ki shakal mein dikhte hain.",
      "Naya rang likhein. Hum purane sizes aur qeematein copy kar dete hain taake sirf wohi badlein jo alag hai. Naye rang ka stock 0 se shuru hota hai.",
      "Navy mein ab wohi paanch sizes aur qeematein pehle se bhari hui hain. Agar Navy mehngi hai to qeemat badal dein, aur apna Navy ka stock likhein.",
      "Navy ki photos add karein. Har rang ki apni photos hoti hain – customer jab rang chunta hai to sahi photos dekhta hai.",
      "“Save changes” dabayein. Aap ki website par ab product mein Ivory aur Navy ke buttons hain.",
      "Stock mein is kurte ki EK line nazar aayegi total ke saath, aur kholne par Ivory aur Navy ke sizes andar milenge.",
    ],
  },
  excel: {
    title: "4. Excel se bohat se products",
    blurb: "Sheet ko table ki tarah bharein. Jin lines ka naam ek jaisa ho wo ek product ke rang ban jate hain.",
    steps: [
      "Products → “Add many at once”. “Download the Excel sheet” dabayein. Wo Excel ya Google Sheets mein khulti hai.",
      "Har size ki ek line. Har line par product ka wohi naam likhein. Wohi shirt doosre rang mein? Naam wohi, rang alag – hum unhein khud jod dete hain.",
      "File save karein aur dibbe mein daal dein. Hum parhte hain aur agar kuch ghalat ho to saaf alfaaz mein line number ke saath bata dete hain.",
      "Pictures add karein. Sheet ke “Photo file names” column mein unke naam likhein, phir saari pictures ek saath kheench kar daal dein.",
      "“Add my products” dabayein. Jin products ki picture nahi hoti wo Hidden save hote hain taake customer ko khali page kabhi na dikhe.",
    ],
  },
  stock: {
    title: "5. Stock aur qeematein theek rakhein",
    blurb: "Har product ki ek list, category ke hisaab se. Product kholein aur size badlein.",
    steps: [
      "Stock mein har product ki ek line total ke saath hoti hai. Category ke buttons use karein – “Shirts” dabayein to sirf shirts nazar aayengi.",
      "Product ki line (ya “Sizes”) dabayein to khul jati hai. Har rang aur har size ka number nazar aata hai.",
      "Number badlein to sirf usi line par Save ka button aa jata hai. Dabayein – customers ko naya number foran nazar aata hai.",
      "“Running low” aur “Sold out” dikhate hain kya dobara mangwana hai. Jab kuch kam hota hai to aap ke computer par alert bhi aata hai.",
      "Bohat si qeematein badalni hain? “Update with Excel” se saari qeematon aur stock ki sheet milti hai. Numbers badlein, upload karein, bas.",
    ],
  },
  orders: {
    title: "6. Order shuru se akhir tak",
    blurb: "Confirm → pack → TCS book → raaste mein → deliver. Seedhay qadam, har ek ka ek button.",
    steps: [
      "Naye order ka alert aap ke computer par aata hai. Orders kholein: “Needs you” tab mein naye orders hote hain.",
      "Customer ko call ya WhatsApp kar ke address pakka karein. Phir “Confirm” dabayein.",
      "Pack karein, phir “Book TCS” dabayein. Aap ko tracking number aur print karne ka label milta hai. (Bohat se orders? Sab par tick lagayein aur ek saath book karein.)",
      "Jab TCS parcel utha leta hai to order khud “With TCS” mein chala jata hai. Us waqt se wo cancel nahi ho sakta.",
      "Jab TCS deliver kar deta hai to order Delivered ho jata hai, cash-on-delivery paid mark ho jati hai aur customer ko bata diya jata hai. Aap ko kuch nahi karna padta.",
    ],
  },
  refunds: {
    title: "7. Cancel aur refund",
    blurb: "TCS ke parcel uthane tak cancel ho sakta hai. Delivery ke baad customer maangta hai – faisla aap ka.",
    steps: [
      "Cancel karne ke liye order kholein aur “Cancel order” dabayein. Wajah chunein – is se stock bhi wapas shelf par chala jata hai.",
      "Agar customer pehle hi paisay de chuka tha to aap ke liye refund khud khul jata hai, taake kisi ka paisa na bhoolein.",
      "Delivery ke baad customer, aap ke refund din ke andar, Track-your-order page se refund maang sakta hai. Aap ko us ki wajah aur photos nazar aati hain.",
      "Paisay bhejein (bank transfer ya JazzCash), phir “Mark refunded” dabayein. Customer ko bata diya jata hai aur order par Refunded likha aa jata hai.",
    ],
  },
  website: {
    title: "8. Aap ki website aur dukaanein",
    blurb: "Jo pictures customer dekhte hain badlein, aur har dukaan map ke nishaan ke saath likhein.",
    steps: [
      "Website pictures: jagah chunein (bara banner, share picture, category cards) aur nayi picture chunein. Ek minute ke andar website par badal jati hai.",
      "Shop locations: “Add a shop” dabayein. Address likhna shuru karein aur sahi line chunein – hum aap ke rukne tak intezaar karte hain, phir search karte hain.",
      "Dukaan ka naam, phone aur kholne ke auqaat likhein aur “Save shop” dabayein. Wo website ke footer, Contact page aur Google par local dukaan ke taur par aa jati hai.",
      "Delivery charges: har qeemat ki ek line – shehar likhein, qeemat aur kitne din lagte hain. Customers ko checkout par yahi nazar aata hai.",
    ],
  },
  sales: {
    title: "9. Sale aur discount codes",
    blurb: "Chand din ki flash sale chalayein, ya kisi customer ko code dein.",
    steps: [
      "Flash sales: “New sale” dabayein, naam, discount aur shuru/khatam hone ka waqt dein. Website par qeematein khud kam ho jati hain aur khud wapas aa jati hain.",
      "Jin logon ne cheez wishlist mein rakhi thi unhein sale shuru hone par alert milta hai – sab se achhi ishtehari bilkul muft.",
      "Discount codes: EID10 jaisa code, kitna discount aur aakhri din likhein. Instagram ya WhatsApp par share karein. Customers checkout par likhte hain.",
    ],
  },
  settings: {
    title: "10. Settings, hifazat aur safai",
    blurb: "Kya ek baar set karna hai, aur wo chand advanced faislay jo aap befikri se nazar andaz kar sakte hain.",
    steps: [
      "Settings mein aap ka phone, WhatsApp, social links, TCS pickup address, bank ki tafseel aur refund ke din hote hain. Badlein, phir “Save settings” dabayein.",
      "Har computer par jo aap istemaal karte hain order alerts on karein: neeche baayein “Turn on order alerts”, phir Allow. Naye orders, receipts, refunds aur kam stock ki khabar milegi.",
      "“Advanced” jaan boojh kar band hai – aksar dukaanon ko isay chherne ki zaroorat nahi. Yahan ek faisla hai: sold-out products itne din ke baad chhupa dein (0 ka matlab hamesha rakhein).",
      "Purani sold-out photos isi jagah “made smaller” ho sakti hain. Wo aap ke record ke liye rehti hain magar naye products ke liye jagah khali kar deti hain.",
      "Aakhir mein: apna password raaz rakhein, shared computer par log out karein (neeche baayein), aur password ke saath page ka address kabhi share na karein.",
    ],
  },
  google: {
    title: "11. Google par nazar aayein",
    blurb: "Nayi dukaan ko log tab dhoondte hain jab wo Google par nazar aaye. Pehle mahinon mein kya karna hai – qadam ba qadam.",
    steps: [
      "Har product page par pehle se wo sab hai jo Google aur AI assistants ko chahiye: naam, qeemat, stock, rang, photos, aap ki dukaanon ke address. Aap ka kaam achhe alfaaz dena hai.",
      "Products ka naam waisa rakhein jaisa log search karte hain: “Ivory Cotton Kurta for Men”, “Style 204” nahi. “Be found on Google” ke phrases tafseel mein aasaan jumlon mein istemaal karein.",
      "Google aur Bing ko yaqeen dilayein ke website aap ki hai: Settings → Advanced, Search Console ka code paste karein, phir wahan Verify dabayein. Phir sitemap bhejein: nureasmir.com/sitemap.xml.",
      "Mall of Lahore wali dukaan ka muft Google Business Profile banayein, naam, address aur phone bilkul wohi jo website par hai. Isi se aap Google Maps aur “near me” mein aate hain.",
      "Apna naam har jagah phelayein: website ka link Instagram, Facebook, TikTok bio, WhatsApp Business, aur Pakistani directories mein lagayein.",
      "Phir sabar aur istiqamat: nayi cheezein baar baar daalein, tafseel imandari se likhein, aur website tez rakhein. Domain ki umr ki ahmiyat hai – sukoon se chalne wali dukaan shor machane wali se behtar hai.",
    ],
  },
  messages: {
    title: "12. Customers ko message likhein",
    blurb: "Phone par notification (muft), kisi ek customer ko email, ya apni poori list ko email.",
    steps: [
      "Messages kholein (Grow ke neeche). Notification wala tab un logon ke phone par chota message bhejta hai jinhon ne notifications allow ki hain. Ye muft hai aur is ki koi hadd nahi.",
      "Chota sa title aur message likhein. Daayein taraf wala dabba bilkul wesa dikhata hai jaisa phone par nazar aayega. Ek hi baat likhein: “Eid sale aaj raat se”.",
      "Chunein ke kis ko jaye. Pehle hamesha “My own devices” par test bhejein – aap apne phone par dekh lein. Phir un logon ko bhejein jinhon ne sale alerts maange thay.",
      "“Send now” dabayein aur confirm karein. Notification wapas nahi li ja sakti, isliye page ek baar poochta hai. “Sent recently” mein nazar aata hai ke kitne phones tak pahunchi.",
      "Email wala tab kisi ek customer ko likhta hai – order number likhein, Find dabayein, aur tayyar jawab se shuru karein (shukriya, confirm karein, size madad, deri, stock khatam). Email nahi hai? WhatsApp par jawab ek button se de dein.",
      "Poori list ko likhna ho to “Everyone on my email list” chunein. Har email mein unsubscribe link hota hai, aur page bhejne se pehle batata hai ke aaj kitni muft emails baqi hain.",
      "Aap ko bhi alerts milte hain: naya order, payment receipt, refund, kam stock, aur ab “TCS booked” tracking number ke saath. Har computer par jahan kaam karte hain order alerts on karein.",
    ],
  },
  words: {
    title: "13. Website ke alfaz aur top bar",
    blurb: "Our story page badlein, top bar ko scroll karwayein, aur jaanein tabdeeli kitni der mein nazar aati hai.",
    steps: [
      "Our story page (Your website): bara heading aur text badlein. Paragraphs ke darmiyan khali line chorein. Kisi line ke shuru mein > lagayein to wo bara quote ban jati hai.",
      "Save dabayein. “Go back to the original wording” kabhi bhi aap ki tabdeeliyan wapas kar deta hai. Saath wali tasveer Website pictures mein badli jati hai.",
      "Settings → Top bar: chunein ke lines kaise chalein – ek ek line, ya left ya right taraf scroll hoti hui news ticker ki tarah. Chhoone se scrolling ruk jati hai.",
      "Preview asli top bar ko chalte hue dikhata hai, phone ke frame mein aur computer ke frame mein. Pasand aaye to band karein aur “Save settings” dabayein.",
      "Jo kuch customers dekhte hain us ko save karne ke baad ek note aata hai: “Your website will show this in about 3 minutes”. Website apne pages ki saved copies customers ke qareeb rakhti hai taake tez khule, aur wo har chand minute mein naye ho jate hain.",
      "Zyada jagah chahiye? Logo ke saath wala chota panel button menu ko choti icons ki patti bana deta hai – icon par mouse le jayein to naam dikhta hai. Dobara dabayein to menu wapas. Aap ki pasand yaad rakhta hai.",
    ],
  },
  practice: {
    title: "14. Practice shop",
    blurb: "Wohi admin, nakli data ke saath – bina kisi khatre ke har cheez par click karein. Kar ke seekhein.",
    steps: [
      "Menu ke bilkul neeche, “Learn” ke tahat, “Practice shop” hai. “Start practice” dabayein aur taqreeban 10 second intezar karein jab tak tayyar ho. Dobara sign in nahi karna parta: aap sign in hi rehte hain.",
      "Upar narangi patti likhi hoti hai PRACTICE SHOP, taake aap kabhi asli dukaan se na milayein. Wahan se kuch customer tak nahi pahunchta: na email, na WhatsApp, na TCS, na notification.",
      "Roz ke liye clicks ki ek tay tadad milti hai, aur patti unhein ginti rehti hai. Products ya orders kitne daal sakte hain aur storage (1 MB) ki bhi choti hadd hai taake sab saaf rahe. Agle din nayi shuru hoti hai.",
      "Gadbad ho gayi? Narangi patti mein “Start again” dabayein. Har product, order aur setting wapas shuru wali halat mein aa jati hai. Kaam khatam ho to “Leave practice” dabayein aur asli dukaan mein wapas aa jayein.",
      "Ye is tarteeb se kar ke dekhein: sizes ke saath product daalein; order confirm karein aur tracking number daalein; ek order cancel karein; flash sale banayein; notification likhein; Our story page badlein. Jab tak aasaan na lage dohrayein.",
    ],
  },
};

export type Lang = "ur" | "en";

/** Words on the Training page itself, in both languages. */
export const UI: Record<Lang, Record<string, string>> = {
  ur: {
    watch: "Dekhein (video jaisa)",
    read: "Parhein (text guide)",
    language: "Zubaan",
    back: "← Peechay",
    play: "▶ Chalayein",
    pause: "❚❚ Rokein",
    playAgain: "▶ Dobara chalayein",
    next: "Agay →",
    speed: "Raftaar",
    wide: "Bara dekhein",
    unwide: "Lesson list dikhayein",
    full: "Poori screen",
    leaveFull: "Poori screen se nikalein",
    stepOf: "Qadam {a} / {b}",
    watched: "{a} / {b} dekhay",
    finished: "Aap ne “{t}” mukammal kar liya",
    again: "Dobara dekhein",
    nextLesson: "Agla:",
    minSteps: "{m} min · {n} qadam",
    watchVideo: "Video mein dekhein",
    guideIntro: "Har lesson ke qadam likhay hue hain – video dekhne ki jagah ya uske saath parhein. Screen ke alfaaz English mein rakhe gaye hain kyun ke asli admin mein buttons English mein hain.",
    routineTitle: "Ek achha din, tarteeb se",
    answersTitle: "Fori jawab",
  },
  en: {
    watch: "Watch (like a video)",
    read: "Read (text guide)",
    language: "Language",
    back: "← Back",
    play: "▶ Play",
    pause: "❚❚ Pause",
    playAgain: "▶ Play again",
    next: "Next →",
    speed: "Speed",
    wide: "Wide view",
    unwide: "Show lesson list",
    full: "Full screen",
    leaveFull: "Leave full screen",
    stepOf: "Step {a} of {b}",
    watched: "{a} of {b} watched",
    finished: "You finished “{t}”",
    again: "Watch again",
    nextLesson: "Next:",
    minSteps: "{m} min · {n} steps",
    watchVideo: "Watch it as a video",
    guideIntro: "Every lesson’s steps are written out – read them instead of, or along with, the video. The words on the screens stay in English because the real admin’s buttons are in English.",
    routineTitle: "A good day, in order",
    answersTitle: "Quick answers",
  },
};

export const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

export const ROUTINE: Record<Lang, Array<[string, string]>> = {
  ur: [
    ["Subah (5 minute)", "Home kholein. “To do now” par kaam karein: naye orders confirm karein, bank receipts dekhein, pack hue orders par TCS book karein."],
    ["Dopehar ke baad (2 minute)", "Stock → Running low dekhein. Jin mein 1–2 bachay hain unhein dobara mangwayein. WhatsApp messages ka jawab dein."],
    ["Shaam (5 minute)", "Refunds aur wo orders dekhein jo “Needs you” par reh gaye. Achhi photo ke saath ek-do products daalein."],
    ["Har hafta", "3–5 products add ya naye karein, Instagram par post karein, 7 aur 30 din ka haal dekhein."],
    ["Har mahina", "Search Console dekhein (kaun se alfaaz log laate hain), mausam ke hisaab se qeematein badlein, aur Settings → Advanced dekhein."],
  ],
  en: [
    ["Morning (5 minutes)", "Open Home. Work through “To do now”: confirm new orders, check bank receipts, book TCS for packed orders."],
    ["After lunch (2 minutes)", "Look at Stock → Running low. Reorder anything with 1–2 left. Reply to WhatsApp messages."],
    ["Evening (5 minutes)", "Check Refunds and any orders that stayed on “Needs you”. Add a product or two with a good photo."],
    ["Every week", "Add or refresh 3–5 products, post on Instagram, check how the shop is doing for 7 and 30 days."],
    ["Every month", "Check Search Console (which phrases bring people), update prices for the season, and look at Settings → Advanced."],
  ],
};

export const ANSWERS: Record<Lang, Array<[string, string]>> = {
  ur: [
    ["Customer cancel karna chahta hai. Kar sakte hain?", "Haan, jab tak TCS ne parcel nahi uthaya. Us ke baad Cancel ka button band ho jata hai – customer se kahein delivery se inkar kar de, ya returns istemaal karein."],
    ["Qeemat mein ghalti ho gayi.", "Stock → product kholein → qeemat badlein → us line par Save. Website kuch hi seconds mein badal jati hai."],
    ["Product “Sold out” dikha raha hai magar mere paas hai.", "Stock → kholein → In stock ka number barhayein → Save. “Held” wo hai jo orders ke liye rukha hua hai aur abhi deliver nahi hua."],
    ["Maine wohi shirt doosre rang mein alag product bana di.", "Ek product kholein, “Add another colour” dabayein, rang wahan daalein, phir duplicate ko hide ya delete kar dein."],
    ["Password bhool gaya.", "Developer se kahein reset kar de. WhatsApp par kabhi password share na karein."],
    ["Kuch kharab nazar aa raha hai.", "Ek baar F5 dabayein. Phir bhi ghalat ho to developer ko page ka naam aur screenshot WhatsApp karein."],
  ],
  en: [
    ["A customer wants to cancel. Can I?", "Yes, until TCS has collected the parcel. After that the Cancel button is off – ask the customer to refuse delivery, or use returns."],
    ["I made a mistake in a price.", "Stock → open the product → change the price → Save on that row. The website updates in seconds."],
    ["A product shows “Sold out” but I have it.", "Stock → open it → raise the In stock number → Save. “Held” numbers are for orders not delivered yet."],
    ["I added the same shirt in another colour as a separate product.", "Open one product, press “Add another colour”, add the colour there, then hide or delete the duplicate."],
    ["I forgot my password.", "Ask the developer to reset it. Never share it on WhatsApp."],
    ["Something looks broken.", "Press F5 once. If it is still wrong, WhatsApp the developer with the page name and a screenshot."],
  ],
};
