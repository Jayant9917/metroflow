import { AdminDetail } from "../../admin-detail";
export default async function Page({ params }: { params: Promise<{ auditId: string }> }) { return <AdminDetail kind="audit" id={(await params).auditId} />; }
