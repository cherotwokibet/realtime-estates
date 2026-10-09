import Image from 'next/image';
import Link from 'next/link';
import {searchCatalogue} from '@realtor/demo/search';
import {formatKes,kesFromMajor,kesFromMinor} from '@realtor/domain';
import {tenantSlug,tenantBrand} from '../lib/tenant';

type Query = Record<string,string|string[]|undefined>;
function Icon({kind}:{kind:'pin'|'search'|'bed'|'bath'|'area'|'arrow'}){
 const paths={pin:<><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,bed:<path d="M3 18v-8m18 8v-8M3 15h18M5 10V6h14v4M3 10h18v5M7 10V8h4v2m2 0V8h4v2"/>,bath:<path d="M3 12h18m-16 0V5a2 2 0 0 1 4 0m-5 7v3a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5v-3M7 20v2m10-2v2"/>,area:<path d="M4 10V4h6m4 0h6v6m0 4v6h-6m-4 0H4v-6M4 4l5 5m11-5-5 5M4 20l5-5m11 5-5-5"/>,arrow:<path d="M4 12h15m-6-6 6 6-6 6"/>};
 return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}
function conceptPhoto(id:string,type:string){
 if(type==='bedsitter')return '/demo/bedsitter-room.jpg';
 if(type==='studio')return '/demo/studio-room.jpg';
 return id==='demo-kitengela-1'?'/demo/bedsitter-exterior.jpg':'/demo/studio-exterior.jpg';
}

export default async function Home({searchParams}:{searchParams:Promise<Query>}){
 const q=await searchParams;
 const {location,purpose,type,maxText,error,items:properties}=searchCatalogue(tenantSlug,q);
 const brand=tenantBrand,money=(n:number)=>formatKes(kesFromMinor(n));
 const filtered=Boolean(location||purpose||type||maxText);
 // Associate the current single search error with its actual field, rather than marking every filter invalid.
 const errorFields=error==='Use one value for each search filter.'?['location','purpose','type','max'].filter(key=>q[key]!==undefined&&typeof q[key]!=='string')
  :error==='Choose rent or buy.'?['purpose']:error==='Choose a supported property type.'?['type']
  :error==='Enter a positive maximum price in KES.'||error==='Enter a valid KES amount with at most two decimal places.'?['max']:[];
 const validation=(field:string)=>errorFields.includes(field)?{'aria-invalid':true as const,'aria-describedby':'search-error'}:{};
 return <>
  <div className="preview"><span className="preview-dot"/>Design preview · Sample listings and illustrative AI images. Enquiries are not sent.</div>
  <header className="site-header container">
   <Link href="/" className="brand" aria-label={brand.name+' home'}><span className="brand-mark">{brand.initials}</span><span>{brand.name}<small>Find your next place</small></span></Link>
   <nav aria-label="Main navigation"><Link href="/?purpose=rent" aria-current={purpose==='rent'?'page':undefined}>Rent</Link><Link href="/?purpose=sale" aria-current={purpose==='sale'?'page':undefined}>Buy</Link><a href="#how">Our approach</a></nav>
   <a className="header-link" href="#properties">Explore properties <Icon kind="arrow"/></a>
  </header>
  <main id="main">
   <section className="hero" aria-labelledby="hero-title">
    <Image src="/demo/studio-exterior.jpg" alt="Illustrative AI concept of a residential building; not a photograph of an available property." fill priority sizes="100vw" className="hero-image"/>
    <div className="hero-shade"/>
    <div className="hero-copy container"><div className="hero-eyebrow"><span/>NAIROBI &amp; BEYOND</div><h1 id="hero-title">Find a place<br/>that feels like home.</h1><p>A new chapter starts with the right space.<br className="desktop-break"/> Explore homes to rent and buy, with the details that matter.</p><a className="hero-link" href="#search">Start your search <Icon kind="arrow"/></a></div>
    <span className="hero-disclosure">AI concept image · illustrative</span>
   </section>
   <section className="search-wrap container" id="search" aria-labelledby="search-title">
    <form key={JSON.stringify([location,purpose,type,maxText,error])} action="/" className="search-panel" aria-describedby={error&&!errorFields.length?'search-error':undefined}>
     <div className="search-top"><h2 id="search-title">What are you looking for?</h2><fieldset className="purpose-tabs" {...validation('purpose')}><legend className="sr-only">Looking to rent or buy</legend>{[{value:'',label:'All properties'},{value:'rent',label:'Rent'},{value:'sale',label:'Buy'}].map(option=><label key={option.label}><input type="radio" name="purpose" value={option.value} defaultChecked={purpose===option.value}/><span>{option.label}</span></label>)}</fieldset></div>
     <div className="search-form">
      <label className="search-field"><span>Location</span><div><Icon kind="pin"/><input name="location" defaultValue={location} placeholder="Neighbourhood or county" autoComplete="off" {...validation('location')}/></div></label>
      <label className="search-field"><span>Property type</span><select name="type" defaultValue={type} {...validation('type')}><option value="">All property types</option>{['apartment','bedsitter','studio','maisonette','land'].map(t=><option key={t} value={t}>{t[0]?.toUpperCase()+t.slice(1)}</option>)}</select></label>
      <label className="search-field"><span>Maximum price (KES)</span><input name="max" type="number" min="0.01" step="0.01" defaultValue={maxText} placeholder="Any budget" {...validation('max')}/></label>
      <button className="primary search-button" type="submit"><Icon kind="search"/>Search properties</button>
     </div>
     {error&&<p role="alert" id="search-error" className="error">{error}</p>}
    </form>
   </section>
   <section className="collection container" id="properties" aria-labelledby="collection-title">
    <div className="section-head"><div><div className="eyebrow">YOUR NEXT CHAPTER</div><h2 id="collection-title">{purpose==='rent'?'Spaces to call home.':purpose==='sale'?'A place to make your own.':'Find your kind of place.'}</h2><p>Thoughtful details. Clear prices. Room to imagine what comes next.</p></div><div className="results-summary"><span>{properties.length} sample {properties.length===1?'property':'properties'}</span>{filtered&&<Link href="/">Clear filters</Link>}</div></div>
    {filtered&&!error&&<div className="active-filters" aria-label="Current search filters">{location&&<span><Icon kind="pin"/>{location}</span>}{purpose&&<span>{purpose==='rent'?'For rent':'For sale'}</span>}{type&&<span>{type[0]?.toUpperCase()+type.slice(1)}</span>}{maxText&&<span>Up to {formatKes(kesFromMajor(maxText))}</span>}</div>}
    {properties.length?<div className="property-grid">{properties.map(p=><article className="property-card" key={p.id}>
     <Link href={'/properties/'+p.id} className="property-photo" aria-label={'View '+p.title}><Image src={conceptPhoto(p.id,p.type)} alt="Illustrative AI property concept, reused for sample listings; not a photograph of this property." fill sizes="(max-width: 640px) 100vw, (max-width: 1000px) 50vw, 33vw"/><span className="purpose-badge">{p.purpose==='rent'?'For rent':'For sale'}</span><span className="image-disclosure">AI concept · illustrative</span></Link>
     <div className="property-body"><p className="location"><Icon kind="pin"/>{p.neighbourhood}, {p.county}</p><h3><Link href={'/properties/'+p.id}>{p.title}</Link></h3><p className="property-type">{p.type[0]?.toUpperCase()+p.type.slice(1)}</p><div className="specs"><span><Icon kind="bed"/>{p.bedrooms===null?'N/A':p.bedrooms===0?(p.type==='studio'?'Studio':'Bedsitter'):p.bedrooms+' beds'}</span><span><Icon kind="bath"/>{p.bathrooms===null?'Not supplied':p.bathrooms+' '+(p.bathrooms===1?'bath':'baths')}</span><span><Icon kind="area"/>{p.areaSqm} m²</span></div><div className="price-row"><div><strong>{money(p.priceMinor)}{p.rentalPeriod&&<small> / {p.rentalPeriod}</small>}</strong><p>{p.purpose==='rent'?'Base rent':'Sale price'} · Fees not supplied</p></div><Link href={'/properties/'+p.id} className="card-arrow" aria-label={'Details for '+p.title}><Icon kind="arrow"/></Link></div></div>
    </article>)}</div>:<div className="empty"><span className="empty-icon"><Icon kind="search"/></span><h3>No properties match your search.</h3><p>Try another neighbourhood, property type or budget.</p><Link className="primary" href="/">Reset search <Icon kind="arrow"/></Link></div>}
   </section>
   <section className="approach" id="how"><div className="container"><div className="approach-heading"><div><div className="eyebrow">A CLEARER WAY HOME</div><h2>A little less searching.<br/>A little more possibility.</h2></div><p>Start with the essentials, explore the details,<br/>and feel ready for your next step.</p></div><ol className="approach-grid"><li><span className="step-number">01</span><h3>Find your fit</h3><p>Narrow your search by location, property type and budget. Your priorities come first.</p></li><li><span className="step-number">02</span><h3>See the whole picture</h3><p>Explore layouts, amenities and exact base prices, with additional fees clearly identified.</p></li><li><span className="step-number">03</span><h3>Take the next step</h3><p>Enquiries and viewing requests will connect you with the agency when those services launch.</p></li></ol></div></section>
  </main>
  <footer className="site-footer"><div className="container footer-top"><div><Link href="/" className="brand"><span className="brand-mark">{brand.initials}</span><span>{brand.name}<small>Better spaces. Clearer choices.</small></span></Link></div><nav aria-label="Footer navigation"><Link href="/?purpose=rent">Homes to rent</Link><Link href="/?purpose=sale">Homes to buy</Link><a href="#how">Our approach</a></nav></div><div className="container footer-bottom"><p>Independent design preview · Sample data and illustrative AI concepts.</p><span>Contact details and reviewed policies are pending.</span></div></footer>
 </>;
}
