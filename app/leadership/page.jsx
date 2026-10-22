import { asset } from '@/lib/site';
export const metadata = { title: 'Leadership' };

const leaders = [
  {
    name: 'Larry LaPlue',
    role: 'Executive Director',
    image:
      asset('/images/Larry_Headshot.jpg'),
    bio: [
      'Larry LaPlue has worked as a volunteer in providing services to individuals with disabilities for the past 20 years. Activities include volunteering at summer camps for families affected by disability, helping coordinate an annual banquet for individuals with disabilities, and helping lead international trips to perform wheelchair distributions.',
    ],
  },
  {
    name: 'Darlene LaPlue',
    role: 'Events Planner/Board Member',
    image:
      asset('/images/Darlene_Headshot.jpg'),
    bio: [
      'Darlene LaPlue is a farm girl from Kentucky who loves Jesus and loves being busy about the work of His Kingdom. She fell in love with disability ministry nearly 25 years ago as she met so many amazing and beautiful people and began seeing the heart of God as she had never seen it before. Her part in this ministry now includes: planning the annual Luke 14 Dinner Party, helping lead teams going to Kenya to distribute wheelchair, directing Camp Celebrate, and teaching am Adult Special Friends Sunday School Class at her church in Morristown. Her spiritual gift is throwing a party. She is working to take back the “party” for The Kingdom!',
    ],
  },
  {
    name: 'Lee Anne LaPlue',
    role: 'Board Director',
    image:
      asset('/images/IMG_20241101_112907.jpg'),
    bio: [
      'Though raised in East Tennessee, Lee Anne LaPlue has participated in disability ministry around the world. Lee Anne grew up volunteering at Joni and Friends family retreats and went on a Wheels for the World wheelchair distribution to Ghana while in college. These experiences lit a fire in her which later propelled her to move to Nigeria where, while teaching, she joined hands with a local orphanage for children with special needs. To better serve friends with disabilities, Lee Anne later sought a doctorate in Occupational Therapy, which she now uses to serve children in Phoenix, Arizona through an outpatient pediatric clinic that specializes in sensory processing disorder. Lee Anne has been heavily involved in Luke 14 Ministries since its inception.',
    ],
  },
  {
    name: 'Julia Erman',
    role: 'Founder & Director of The Hazelnut Movement',
    image:
      asset('/images/IMG_0710.jpg'),
    bio: [
      'Julia is a woman of many roles: a loving wife, devoted mother, speaker, and an inspiration to all who hear her story. Her passion for working with children, combined with her personal journey as a special-needs parent, has propelled her to become a key advocate in the world of special-needs education. As of July 2024, Julia is also a driving force behind The Hazelnut Movement, one of the four core programs of Luke 14 Ministries.',
    ],
  },
  {
    name: 'Nick Decosimo',
    role: 'Board Member',
    image:
      asset('/images/Nick.jpg'),
    bio: [
      'Nick Decosimo is a senior advisor at Decosimo Corporate Finance. Before that, he was managing shareholder for the Chattanooga office and member of the Executive Committee of Elliott Davis, a large regional CPA firm. Prior to its merger with Elliott Davis, Nick served as the firm-wide managing partner of Decosimo, a regional CPA firm headquartered in Chattanooga. His community service includes chairing the Chattanooga Chamber, the Chattanooga United Way, the Generosity Trust, and ArtsBuild among others. He was an Echols Scholar at the University of Virginia and received his MBA from UNC-Chapel Hill.',
    ],
  },
  {
    name: 'Debbie Salansky',
    role: 'Board Member',
    image:
      asset('/images/Debbie.jpeg'),
    // 280×320 original: shown at its own size, not stretched.
    cap: 'max-w-[280px] max-h-[320px]',
    bio: [
      'Debbie Salanksy is a physical therapist and former Director of Rehabilitation who resides in Morristown, Tennessee. She has worked extensively both in-country and abroad, in both professional capacities and as a volunteer, with a wide range of people across the lifespan. In her international travels, she directly served individuals/families with assessments and fitting of adaptive equipment. She has volunteered by working with trip preparation, equipment modification and training therapists as well as STM volunteers involved in Luke 14 Ministry. She views ministry involvement as a priority and considers working with others a blessing and an act of worship.',
    ],
  },
  {
    name: 'Gary Salansky',
    role: 'Board Member',
    image:
      asset('/images/Gary.jpeg'),
    bio: [
      'Better known as Coach Sal - a long time educator and coach with experience in both the public and private Christian school settings, Gary resides in Morristown, Tennessee. His personal connection to disability ministry began in college while working with Special Olympics and has continued in many other arenas. He has worked with special needs populations in public education and has volunteered in many varied Luke 14 ministry outreaches, both here at home and in Kenya. He has fostered two special needs children and works with Joy Unspeakable which is an adult special needs church small group. He feels a deep responsibility to honor God and carry out his father’s legacy in memory of a loved one affected by disability.',
    ],
  },
  {
    name: 'Laura Payne',
    role: 'Board Member',
    image:
      asset('/images/Laura.png'),
    // 237×237 original: shown at its own size, not stretched. A larger photo is wanted.
    cap: 'max-w-[237px] max-h-[237px]',
    bio: [
      'Laura Payne has experienced disability since birth with cerebral palsy for 63 years.',
      'Laura’s family is precious to her and has shaped her perspective about life, the Lord, and people from her earliest years. Laura first was introduced to Joni Eareckson Tada when she was a teenager recovering from major surgery in a Memphis hospital. Laura also experienced life with other girls with disabilities at that hospital and understood connecting in new ways with people of all backgrounds. From then, Laura wanted to make a difference with and for people affected by disabilities. Laura was given educational opportunities in rehabilitation and special education in her late 20’s and early 30’s. Laura has served in disability advocacy and ministry for 36 years. Laura is grateful for the Lord, family, and friends who have shared life, including Darlene LaPlue and her family in 45 years of friendship!',
    ],
  },
  {
    name: 'Vova Gorbenko',
    role: 'Board Member',
    image:
      asset('/images/Gorbenko_2.jpg'),
    bio: [
      'Dr. Vova Gorbenko is the Associate Director of Campus Ministries and an Assistant Professor of New Testament. He was born and raised in Ukraine and has over twenty years of experience in teaching, mentoring, and providing leadership to faculty and staff in a seminary setting. He served as The Academic Dean of Zaporizhzhia Bible Seminary for 15 years and taught Hermeneutics and New Testament for 21 years. He also served as senior pastor of a rapidly growing urban church for 14 years. Dr. Gorbenko was a frequent speaker at national pastors’ conferences in Ukraine in the last few years before the war broke out in that country. Now, at Carson-Newman, Dr. Gorbenko primarily teaches Introduction to New Testament courses. He has developed a program for integrating Christian worldview, identity and purpose into the lives and vocations of students in the College and Professional Studies programs. Dr. Gorbenko is happily married to Marina. They have two children: Katya (17) and Andrii (19).',
    ],
  },
  {
    name: 'Patti Baker',
    role: 'Board Member',
    image:
      asset('/images/Patti.jpg'),
    // Tall photo with sky above her: frame lower so the shoulders show too.
    focus: 'object-[50%_70%]',
    bio: [
      'Patti Baker has been involved in special needs ministry with her church for 14 years but has on-the-job training with her daughter Cecilia, a 36-year-old who was born with Angleman Syndrome. She is a special needs mom with a message to share with the world that all special needs folks are worthy of love, grace, mercy, acceptance and that they are a vital part of the body of Christ. She is the chairperson of the Special Needs ministry team at Calvary Baptist, Erwin TN and has led the women’s ministry team at Camp Celebrate for several years. She has been married to Tony for 44 years and resides in Erwin TN.',
    ],
  },
];

export default function LeadershipPage() {
  return (
    <>
      <section className="container-site py-14">
        <h1 className="text-4xl font-bold text-center mb-12">
          Meet Our Leadership
        </h1>

        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {leaders.map((leader) => (
            <div
              key={leader.name}
              className="bg-white rounded-lg shadow-sm overflow-hidden flex flex-col"
            >
              {/* Portrait box (4:5) so every head and shoulders shows at every width.
                  object-top keeps the face in frame; `focus` overrides it for a photo
                  that still crops badly. A photo smaller than the box (`cap`) is shown
                  at its own size, centred, rather than blown up and blurred. */}
              <div className="aspect-[4/5] w-full bg-neutral-100 flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={leader.image}
                  alt={leader.name}
                  className={`w-full h-full object-cover ${leader.focus ?? 'object-top'} ${leader.cap ?? ''}`}
                />
              </div>
              <div className="p-6 flex-1">
                <h2 className="text-xl font-bold">{leader.name}</h2>
                <p className="text-sm font-semibold uppercase tracking-wide text-brand mt-1 mb-4">
                  {leader.role}
                </p>
                {leader.bio.map((paragraph, i) => (
                  <p
                    key={i}
                    className="text-neutral-700 leading-relaxed mb-3 last:mb-0"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
