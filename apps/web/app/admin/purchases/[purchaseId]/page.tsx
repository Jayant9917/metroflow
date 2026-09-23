import { AdminDetail } from "../../admin-detail";
export default async function Page({ params }: { params: Promise<{ purchaseId: string }> }) { return <AdminDetail kind="purchases" id={(await params).purchaseId} />; }
