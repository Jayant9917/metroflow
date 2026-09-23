import { AdminDetail } from "../../admin-detail";
export default async function Page({ params }: { params: Promise<{ journeyId: string }> }) { return <AdminDetail kind="journeys" id={(await params).journeyId} />; }
