import { StoreApp } from "@/components/store-app";

export default function StorePage({ params }: { params: { path?: string[] } }) {
  return <StoreApp route={params.path ?? []} />;
}
