import { CollectionManager } from "./collection-manager";
import { HelpBox } from "../../_ui/client";

export const dynamic = "force-dynamic";

export default async function AdminCollectionsPage() {
  return (
    <>
      <HelpBox id="categories">
        <ol>
          <li>Press <strong>New category</strong> and type a name, like “Shirts”.</li>
          <li>Add a picture for it — customers see it on your home page and category page.</li>
          <li>When you add a product, pick its category. To put one category inside another (like Formal Shirts inside Shirts), choose “Inside which category?”.</li>
        </ol>
      </HelpBox>
      <CollectionManager />
    </>
  );
}
