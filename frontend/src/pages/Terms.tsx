import React from 'react';
import LegalPage, { LegalSection } from '../components/LegalPage';

const Terms: React.FC = () => (
  <LegalPage title="Terms of Use" updated="17 September 2026">
    <LegalSection title="The service">
      <p>
        Fintrack is a personal finance tracker offered as-is by an individual operator. You may use it to record and
        review your own finances. It is a tool for keeping track, not financial advice: the assistant&apos;s
        observations, projections and opinions are generated from your data and public information and can be wrong.
        Decisions you make remain yours.
      </p>
    </LegalSection>

    <LegalSection title="Your account">
      <ul className="list-disc pl-5 space-y-1">
        <li>You must be at least 18 and provide a working email address.</li>
        <li>Keep your password to yourself. You are responsible for activity under your account.</li>
        <li>One account per person. Do not access or attempt to access anyone else&apos;s data.</li>
        <li>The operator may require an invite code, close sign-ups, or limit usage (for example the assistant&apos;s daily allowance) to keep the service affordable and safe.</li>
      </ul>
    </LegalSection>

    <LegalSection title="Bank connections">
      <p>
        Connecting a bank uses Plaid under Plaid&apos;s own end-user terms and privacy policy, which you accept in the
        Plaid Link flow. Fintrack receives balances and transactions, never your bank credentials. You can disconnect at
        any time from Settings.
      </p>
    </LegalSection>

    <LegalSection title="Acceptable use">
      <p>
        Do not use Fintrack to store data you have no right to, to probe or overload the service, or to interfere with
        other users. Automated access is limited to what the app itself does. Accounts that abuse the service may be
        suspended.
      </p>
    </LegalSection>

    <LegalSection title="Availability and changes">
      <p>
        The service is provided without uptime guarantees and may change or pause. Reasonable notice will be given
        before it is discontinued so you can export your data, which you can do at any time from Settings.
      </p>
    </LegalSection>

    <LegalSection title="Liability">
      <p>
        To the extent permitted by law, the operator is not liable for losses arising from your use of Fintrack,
        including decisions taken on the basis of numbers or advice shown in the app, or from bank data that arrives
        late, incomplete or incorrect from a provider.
      </p>
    </LegalSection>

    <LegalSection title="Termination">
      <p>
        You can delete your account at any time from Settings → Account. The operator may close accounts that breach
        these terms. Either way, your data is deleted as described in the Privacy Policy.
      </p>
    </LegalSection>

    <LegalSection title="Governing law and contact">
      <p>
        These terms are governed by the law of the operator&apos;s jurisdiction, which will be named here before
        launch, together with a contact address.
      </p>
    </LegalSection>
  </LegalPage>
);

export default Terms;
