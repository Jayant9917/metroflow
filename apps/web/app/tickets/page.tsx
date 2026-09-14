import { FeaturePage } from "../app-shell";
export default function TicketsPage() { return <FeaturePage title="Your tickets" description="Issued and historical MetroFlow tickets will appear here." links={[{ label: "Start a journey", href: "/journey/new" }]}/>; }
