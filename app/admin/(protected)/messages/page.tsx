import { PageHeader } from "../../_ui/ui";
import { MessagesClient } from "./messages-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages" };

export default function AdminMessagesPage() {
  return (
    <>
      <PageHeader title="Messages" intro="Write to your shoppers: a notification on their phone (free, no limit), or an email to one customer or to your whole email list." />
      <MessagesClient />
    </>
  );
}
