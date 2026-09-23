import { AdminDetail } from "../../admin-detail";
export default async function Page({ params }: { params: Promise<{ ticketId: string }> }) { return <AdminDetail kind="tickets" id={(await params).ticketId} />; }
