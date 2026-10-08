import { getPublicSettings } from "@/lib/commerce";
import { CurrencyProvider, CurrencySwitcher } from "./_components/currency";
import { WhatsAppFloat } from "./_components/floating-widgets";
import { WhatsAppIcon } from "./_components/icons";
import { StoreHeader } from "./_components/store-header";
import { ServiceWorkerRegistrar } from "./_components/sw-register";
import { MobileTabBar } from "./_components/mobile-tab-bar";
import { ShopToaster } from "./_components/shop-toast";
import { AlertsPrompt } from "./_components/alerts-prompt";

/** Shell shared by every storefront page: display-currency context, the floating WhatsApp
 * shortcut (bottom-left) and the currency switcher (bottom-right), as on the benchmark site. */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const settings = await getPublicSettings();
  const digits = settings.whatsappNumber.replace(/[^\d]/g, "");
  const chat = settings.whatsappChatUrl || (digits ? `https://wa.me/${digits}` : "");
  return (
    <CurrencyProvider>
      <StoreHeader />
      {children}
      <WhatsAppFloat href={chat || "/contact"} external={Boolean(chat)}>
        <WhatsAppIcon size={26} />
      </WhatsAppFloat>
      <CurrencySwitcher />
      <ServiceWorkerRegistrar />
      <MobileTabBar />
      <ShopToaster />
      <AlertsPrompt />
    </CurrencyProvider>
  );
}
