import Link from "next/link";

export default function Home() {
  return (
    <main className="page-wrap">
      <section className="card stack">
        <h1>ImoWatch Web MVP</h1>
        <p className="muted-text">Web frontend for zones, market stats, and deals.</p>
        <div className="row">
          <Link href="/auth">Go to login</Link>
          <Link href="/zones">Go to zones</Link>
        </div>
      </section>
    </main>
  );
}
