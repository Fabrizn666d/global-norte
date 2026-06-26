import { AdminApp } from "@/components/admin-app";

export const metadata = {
  title: "Global Norte Perú",
};

export default function AdminPage({ params }: { params: { path?: string[] } }) {
  return <AdminApp route={params.path ?? []} />;
}
