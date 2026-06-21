import { AdminApp } from "@/components/admin-app";

export const metadata = {
  title: "Global Norte - Panel Admin",
};

export default function AdminPage({ params }: { params: { path?: string[] } }) {
  return <AdminApp route={params.path ?? []} />;
}
