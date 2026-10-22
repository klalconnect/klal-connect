import React from 'react';
import { Link } from 'react-router-dom';

// Plain-language terms of use. A working version until the owner has a lawyer
// go over it; keep it in step with what the site actually does, and never let
// it claim the site checks anything beyond the admin "Verified by Klal" mark.
const UPDATED = '22 October 2026';
const link = 'font-semibold text-brand-teal hover:underline';

export default function Terms() {
  return <div className="page-shell max-w-3xl py-10">
    <span className="eyebrow">KLAL CONNECT</span>
    <h1 className="title text-3xl">Terms of use</h1>
    <p className="helper">Last updated {UPDATED}. Klal Connect ("Klal Connect", "we", "us") runs klalconnect.org, a community directory (Resources) and a members' feed and network. These terms cover both. By using the site you agree to these terms. If you don't agree, please don't use the site.</p>

    <div className="prose-klal mt-8 space-y-8 text-brand-body">
      <section>
        <h2 className="section-title">1. Listings and their accuracy</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Listings are the businesses, professionals, shuls and gemachs in the Resources part of the site. Most were compiled from public information and have not been reviewed by the business. They may be incomplete, out of date or wrong.</li>
          <li>A listing marked "Verified by Klal" has been reviewed by our team. Every other listing has not, and even a verified listing can change, so confirm details with the business before you rely on them.</li>
          <li>Kashrus, Shomer Shabbos and similar details are what a business or the public record says. <b>Always check kosher status, hechsher and religious standards yourself</b> with the business, the hechsher or your rav.</li>
          <li>Prices, hours, addresses, licenses and phone numbers can change at any time. Check them directly before you go or hire.</li>
        </ul>
      </section>

      <section>
        <h2 className="section-title">2. Claiming, correcting or removing a listing</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>If a listing is about your business, you can claim it from the listing's page. Once we accept your claim, you can edit it.</li>
          <li>Anyone can send a fix with Suggest a Correction on any listing.</li>
          <li>Business owners can ask us to remove their listing at any time by emailing <a className={link} href="mailto:hello@klalconnect.org">hello@klalconnect.org</a>.</li>
          <li>If you add or claim a listing, what you enter must be true, and you must have the right to represent that business.</li>
          <li>We may edit, hide or remove any listing, for example if it is wrong, out of date, or breaks these terms.</li>
        </ul>
      </section>

      <section>
        <h2 className="section-title">3. Dealing with businesses and members</h2>
        <p className="mt-2">Klal Connect is a place to find and connect with people. We are not part of any deal you make with a business, employer or member, and <b>we are not responsible for the services, products or conduct of anyone listed on the site</b>. We don't guarantee anyone's work, prices, licenses, kashrus or honesty. Do your own checking before you hire, buy or share personal details.</p>
      </section>

      <section>
        <h2 className="section-title">4. Your account</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>You must be at least 13 years old to make an account. If you are under 18, please use the site with a parent's or guardian's permission.</li>
          <li>Give us a real email address and keep your password private. You are responsible for what happens on your account.</li>
          <li>One person per account. Don't make an account for someone else without their permission, or pretend to be someone you're not.</li>
        </ul>
      </section>

      <section>
        <h2 className="section-title">5. The feed, profiles and messages</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Your profile:</b> keep your name, work history and labels such as Open to work, Hiring or Paying for referrals truthful and current.</li>
          <li><b>Who sees your posts:</b> posts, comments and profiles can be seen by members and by visitors browsing the site. Don't post anything you wouldn't want the community to read.</li>
          <li><b>Your content:</b> you own what you post. By posting, you give us permission to show it on the site, and to let other members like, comment on, repost and share links to it, including on other apps such as WhatsApp or LinkedIn. Once something is shared outside Klal Connect, we can't pull it back.</li>
          <li><b>Advice and offers:</b> what members post, including recommendations, advice, job openings and referral offers, is their own, not ours. It is not professional, legal, medical or financial advice. Any job, referral or deal you take up is between you and that member.</li>
          <li><b>Messages</b> are private between you and the other person, though Klal Connect's administrators can see them to deal with reports or misuse. Don't use messages to send unwanted sales pitches to many people.</li>
          <li><b>Don't post anything that</b> is false or misleading, lashon hara about a person or business, harassing or threatening, immodest, hateful or illegal, spam or repeated advertising, someone else's private information, or someone else's photos or writing you don't have the right to use.</li>
          <li>You can delete your own posts at any time. Members can report a post they think breaks these rules. We may remove content and limit or close accounts that break them, with or without warning.</li>
        </ul>
      </section>

      <section>
        <h2 className="section-title">6. Shabbos and Yom Tov</h2>
        <p className="mt-2">The site pauses posting and messaging over Shabbos and Yom Tov based on your location setting, and scheduled posts won't go out then. Times come from standard calculations and may be off; follow your own rav for zmanim.</p>
      </section>

      <section>
        <h2 className="section-title">7. Paid features</h2>
        <p className="mt-2">The site is free today. If we add paid features later, we will show the price and terms before you pay.</p>
      </section>

      <section>
        <h2 className="section-title">8. Privacy</h2>
        <p className="mt-2">Our <Link className={link} to="/privacy">privacy policy</Link> explains what we collect and who can see it.</p>
      </section>

      <section>
        <h2 className="section-title">9. Reporting problems</h2>
        <p className="mt-2">Use Report an issue or Suggest a Correction on any listing, or email <a className={link} href="mailto:hello@klalconnect.org">hello@klalconnect.org</a>. If you think something on the site uses your copyrighted work, email us the link and we will look at it promptly.</p>
      </section>

      <section>
        <h2 className="section-title">10. No guarantees</h2>
        <p className="mt-2">The site and everything on it is provided "as is" and "as available", without warranties of any kind. Information may be wrong or out of date, and the site may sometimes be down.</p>
      </section>

      <section>
        <h2 className="section-title">11. Limits on our responsibility</h2>
        <p className="mt-2">To the fullest extent the law allows, Klal Connect is not liable for any loss or damage that comes from using the site, from information on it, or from dealings with businesses or members you found through it.</p>
      </section>

      <section>
        <h2 className="section-title">12. Ending your account</h2>
        <p className="mt-2">You can stop using the site at any time and ask us to delete your account. We can suspend or close accounts that break these terms.</p>
      </section>

      <section>
        <h2 className="section-title">13. Changes</h2>
        <p className="mt-2">We may update these terms. If a change is important, we will tell members on the site or by email. Using the site after a change means you accept the new terms.</p>
      </section>

      <section>
        <h2 className="section-title">14. Contact</h2>
        <p className="mt-2">Questions about these terms: <a className={link} href="mailto:hello@klalconnect.org">hello@klalconnect.org</a>.</p>
      </section>
    </div>

    <p className="mt-10 text-sm text-brand-muted"><Link to="/" className={link}>Back to Klal Connect</Link></p>
  </div>;
}
