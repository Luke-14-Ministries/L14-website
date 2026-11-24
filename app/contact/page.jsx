import ContactForm from './ContactForm';
import { site } from '@/lib/site';
import { telHref } from '@/lib/phone';

export const metadata = { title: 'Contact' };

export default function ContactPage() {
  return (
    <>
      <section className="bg-brand-dark text-white py-16">
        <div className="container-site text-center">
          <h1 className="text-4xl font-bold">Contact us</h1>
          <p className="mt-4 text-xl max-w-2xl mx-auto">
            If you have any questions or comments, please don&rsquo;t hesitate
            to reach out using the contact form. We look forward to hearing
            from you!
          </p>
        </div>
      </section>

      <section className="container-site py-14">
        <div className="grid gap-12 lg:grid-cols-2 max-w-5xl mx-auto">
          <div>
            <h2 className="text-3xl font-bold mb-8">Get in Touch</h2>
            <div className="space-y-6 text-lg">
              <div>
                <p className="font-bold">Address</p>
                <p className="text-neutral-700">
                  2348 W Andrew Johnson Hwy, #140
                  <br />
                  Morristown, TN 37814
                </p>
              </div>
              <div>
                <p className="font-bold">Email</p>
                <a
                  href="mailto:info@luke14ministries.net"
                  className="text-brand font-semibold underline"
                >
                  info@luke14ministries.net
                </a>
              </div>
              <div>
                <p className="font-bold">Phone</p>
                <a
                  href={telHref(site.phone)}
                  className="text-brand font-semibold underline"
                >
                  {site.phone}
                </a>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-3xl font-bold mb-8">Send a Message</h2>
            <ContactForm />
          </div>
        </div>
      </section>
    </>
  );
}
