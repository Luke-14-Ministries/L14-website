import { asset } from '@/lib/site';
import LeaderBio from './LeaderBio';

export const metadata = { title: 'Leadership' };

// Larry, Darlene and Lee Anne (Board Chair) first, then everyone else A to Z
// by last name, in one grid three to a row (Ellen, 9 Nov 2026: no Staff and
// Board headings, just "Meet Our Leadership").
// The bios are the leaders' own words: slips fixed 9 Nov 2026 (spelling,
// "Luke 14 Ministries", STM spelled out), nothing else changed. Trimming them
// and the figures that go out of date are open in Staff Questions §1.
const leaders = [
  {
    name: 'Larry LaPlue',
    role: 'Co-founder and Executive Director',
    image: asset('/images/leaders/larry-laplue.jpg'),
    bio: [
      'Larry LaPlue has worked as a volunteer in providing services to individuals with disabilities for the past 20 years. Activities include volunteering at summer camps for families affected by disability, helping coordinate an annual banquet for individuals with disabilities, and helping lead international trips to perform wheelchair distributions.',
    ],
  },
  {
    name: 'Darlene LaPlue',
    role: 'Co-founder and Events Planner',
    image: asset('/images/leaders/darlene-laplue.jpg'),
    bio: [
      'Darlene LaPlue is a farm girl from Kentucky who loves Jesus and loves being busy about the work of His Kingdom. She fell in love with disability ministry nearly 25 years ago as she met so many amazing and beautiful people and began seeing the heart of God as she had never seen it before. Her part in this ministry now includes planning the annual Luke 14 Dinner Party, helping lead teams going to Kenya to distribute wheelchairs, directing Camp Celebrate, and teaching an Adult Special Friends Sunday School Class at her church in Morristown. Her spiritual gift is throwing a party. She is working to take back the “party” for The Kingdom!',
    ],
  },
  {
    name: 'Lee Anne LaPlue',
    role: 'Board Chair',
    image: asset('/images/leaders/lee-anne-laplue.jpg'),
    bio: [
      'Though raised in East Tennessee, Lee Anne LaPlue has participated in disability ministry around the world. Lee Anne grew up volunteering at Joni and Friends family retreats and went on a Wheels for the World wheelchair distribution to Ghana while in college. These experiences lit a fire in her which later propelled her to move to Nigeria where, while teaching, she joined hands with a local orphanage for children with special needs. To better serve friends with disabilities, Lee Anne later sought a doctorate in Occupational Therapy, which she now uses to serve children in Phoenix, Arizona, through an outpatient pediatric clinic that specializes in sensory processing disorder. Lee Anne has been heavily involved in Luke 14 Ministries since its inception.',
    ],
  },

  {
    name: 'Patti Baker',
    role: 'Board Member',
    image: asset('/images/leaders/patti-baker.jpg'),
    bio: [
      'Patti Baker has been involved in special needs ministry with her church for 14 years but has on-the-job training with her daughter Cecilia, a 36-year-old who was born with Angelman syndrome. She is a special needs mom with a message to share with the world that all special needs folks are worthy of love, grace, mercy and acceptance, and that they are a vital part of the body of Christ. She is the chairperson of the special needs ministry team at Calvary Baptist in Erwin, TN, and has led the women’s ministry team at Camp Celebrate for several years. She has been married to Tony for 44 years and resides in Erwin, TN.',
    ],
  },
  {
    name: 'Leann Byrd',
    role: 'Board Member',
    image: asset('/images/leaders/leann-byrd.jpg'),
    // Ellen's text (9 Nov 2026), spelling fixed only.
    bio: [
      'Leann Byrd, MD, is originally from Grainger County, TN. She received her undergraduate degree from Carson-Newman College (now University). She completed her medical degree as well as her family medicine training at ETSU College of Medicine.',
      'She returned to Jefferson City, TN, in 2002 and has practiced medicine and raised her family there ever since. Currently, she works with Summit Medical Group in Jefferson City, Morristown, and Newport. She has served as Chief of Staff, Chief of Medicine, and on various committees at Jefferson Memorial Hospital through the years. Currently, she serves on the board of directors for Jefferson Memorial Hospital. She also serves on the board of directors for Renovatus, a drug and alcohol recovery community.',
      'She attends and is active in various ministries at First Baptist Church of Strawberry Plains.',
      'She has volunteered with Camp Celebrate for 10 years and shares their vision for a global church where all are recognized as being created for the glory of God and welcome, active members of His church.',
    ],
  },
  {
    name: 'Nick Decosimo',
    role: 'Board Member',
    image: asset('/images/leaders/nick-decosimo.jpg'),
    bio: [
      'Nick Decosimo is a senior advisor at Decosimo Corporate Finance. Before that, he was managing shareholder for the Chattanooga office and a member of the Executive Committee of Elliott Davis, a large regional CPA firm. Prior to its merger with Elliott Davis, Nick served as the firm-wide managing partner of Decosimo, a regional CPA firm headquartered in Chattanooga. His community service includes chairing the Chattanooga Chamber, the Chattanooga United Way, the Generosity Trust, and ArtsBuild, among others. He was an Echols Scholar at the University of Virginia and received his MBA from UNC-Chapel Hill.',
    ],
  },
  {
    name: 'Vova Gorbenko',
    role: 'Board Member',
    image: asset('/images/leaders/vova-gorbenko.jpg'),
    bio: [
      'Dr. Vova Gorbenko is the Associate Director of Campus Ministries and an Assistant Professor of New Testament. He was born and raised in Ukraine and has over twenty years of experience in teaching, mentoring, and providing leadership to faculty and staff in a seminary setting. He served as Academic Dean of Zaporizhzhia Bible Seminary for 15 years and taught Hermeneutics and New Testament for 21 years. He also served as senior pastor of a rapidly growing urban church for 14 years. Dr. Gorbenko was a frequent speaker at national pastors’ conferences in Ukraine in the last few years before the war broke out in that country. Now, at Carson-Newman, Dr. Gorbenko primarily teaches Introduction to New Testament courses. He has developed a program for integrating Christian worldview, identity and purpose into the lives and vocations of students in the College and Professional Studies programs. Dr. Gorbenko is happily married to Marina. They have two children: Katya (17) and Andrii (19).',
    ],
  },
  {
    name: 'Laura Payne',
    role: 'Board Member',
    image: asset('/images/leaders/laura-payne.jpg'),
    bio: [
      'Laura Payne has experienced disability since birth with cerebral palsy for 63 years.',
      'Laura’s family is precious to her and has shaped her perspective about life, the Lord, and people from her earliest years. Laura was first introduced to Joni Eareckson Tada when she was a teenager recovering from major surgery in a Memphis hospital. Laura also experienced life with other girls with disabilities at that hospital and understood connecting in new ways with people of all backgrounds. From then, Laura wanted to make a difference with and for people affected by disabilities. Laura was given educational opportunities in rehabilitation and special education in her late 20s and early 30s. Laura has served in disability advocacy and ministry for 36 years. Laura is grateful for the Lord, family, and friends who have shared life, including Darlene LaPlue and her family in 45 years of friendship!',
    ],
  },
  {
    name: 'Debbie Salansky',
    role: 'Board Member',
    image: asset('/images/leaders/debbie-salansky.jpg'),
    bio: [
      'Debbie Salansky is a physical therapist and former Director of Rehabilitation who resides in Morristown, Tennessee. She has worked extensively both in-country and abroad, in both professional capacities and as a volunteer, with a wide range of people across the lifespan. In her international travels, she directly served individuals and families with assessments and fitting of adaptive equipment. She has volunteered by working with trip preparation, equipment modification and training therapists, as well as short-term mission (STM) volunteers involved in Luke 14 Ministries. She views ministry involvement as a priority and considers working with others a blessing and an act of worship.',
    ],
  },
  {
    name: 'Gary Salansky',
    role: 'Board Member',
    image: asset('/images/leaders/gary-salansky.jpg'),
    bio: [
      'Better known as Coach Sal, Gary Salansky is a longtime educator and coach with experience in both public and private Christian school settings. He resides in Morristown, Tennessee. His personal connection to disability ministry began in college while working with Special Olympics and has continued in many other arenas. He has worked with special needs populations in public education and has volunteered in many Luke 14 Ministries outreaches, both here at home and in Kenya. He has fostered two special needs children and works with Joy Unspeakable, an adult special needs church small group. He feels a deep responsibility to honor God and carry out his father’s legacy in memory of a loved one affected by disability.',
    ],
  },
];

// Every photo is a round headshot cropped the same way (Lawrence, 9 Nov 2026):
// a square 4.2x the eyes-to-chin distance with the eyes 38% down, so the whole
// head shows with some neck and shoulders; 600x600 in public/images/leaders/.
// A new leader's photo is cropped by the same rule before it goes in.
function LeaderCard({ leader }) {
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden flex flex-col">
      <div className="pt-8 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={leader.image}
          alt={leader.name}
          width={600}
          height={600}
          className="w-44 h-44 rounded-full object-cover ring-1 ring-neutral-200"
        />
      </div>
      <div className="p-6 flex-1">
        <h2 className="text-xl font-bold text-center">{leader.name}</h2>
        <p className="text-sm font-semibold uppercase tracking-wide text-brand text-center mt-1 mb-4">
          {leader.role}
        </p>
        <LeaderBio paragraphs={leader.bio} name={leader.name} />
      </div>
    </div>
  );
}

export default function LeadershipPage() {
  return (
    <section className="container-site py-14">
      <h1 className="text-4xl font-bold text-center mb-12">Meet Our Leadership</h1>

      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
        {leaders.map((leader) => (
          <LeaderCard key={leader.name} leader={leader} />
        ))}
      </div>
    </section>
  );
}
