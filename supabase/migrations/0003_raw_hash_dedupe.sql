begin;

-- Remove historic duplicates so we can enforce source+hash uniqueness.
with ranked as (
  select
    ctid,
    row_number() over (
      partition by source, hash
      order by fetched_at desc, id desc
    ) as rn
  from public.listings_raw
)
delete from public.listings_raw lr
using ranked r
where lr.ctid = r.ctid
  and r.rn > 1;

create unique index if not exists uq_listings_raw_source_hash
  on public.listings_raw(source, hash);

commit;
