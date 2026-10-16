'use client';
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <main id="main" className="container catalogue-problem">
      <h1>We couldn’t load this page.</h1>
      <p role="alert">Please try again. Property availability has not been verified.</p>
      <button className="primary" onClick={retry}>
        Try again
      </button>
      <p>
        <a href="/">Return to property search</a>
      </p>
    </main>
  );
}
