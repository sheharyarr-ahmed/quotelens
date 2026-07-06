-- QuoteLens seed price books
-- Three global template books (user_id null, is_template true).
-- Painting is the default demo book (is_active true); HVAC and landscaping
-- ship as alternates to prove the pattern generalizes.
-- Fixed book UUIDs so item rows can reference them directly.

-- ============================================================
-- template books
-- ============================================================

insert into public.price_books (id, user_id, name, trade, is_template, is_active)
values
  ('00000000-0000-4000-a000-000000000001', null, 'Residential Painting', 'painting', true, true),
  ('00000000-0000-4000-a000-000000000002', null, 'HVAC Service', 'hvac', true, false),
  ('00000000-0000-4000-a000-000000000003', null, 'Landscaping', 'landscaping', true, false);

-- ============================================================
-- painting template (default demo book)
-- covers interior/exterior work including the water-damaged
-- bedroom scenario: stain-block primer, drywall repair,
-- mildew treatment, ceiling and trim work
-- ============================================================

insert into public.price_book_items (price_book_id, name, description, unit, unit_price_cents)
values
  -- walls and ceilings
  ('00000000-0000-4000-a000-000000000001', 'Interior wall paint, 2 coats', 'Two finish coats on interior walls, standard latex', 'sqft', 180),
  ('00000000-0000-4000-a000-000000000001', 'Interior wall paint, 1 coat', 'Single refresh coat on interior walls, same color', 'sqft', 110),
  ('00000000-0000-4000-a000-000000000001', 'Ceiling paint, 2 coats', 'Two coats flat white on ceiling', 'sqft', 160),
  ('00000000-0000-4000-a000-000000000001', 'Ceiling paint, 1 coat', 'Single coat flat white on ceiling', 'sqft', 100),
  ('00000000-0000-4000-a000-000000000001', 'Accent wall, color change', 'Full color change on one wall, includes extra coat', 'sqft', 220),
  ('00000000-0000-4000-a000-000000000001', 'Dark-to-light color change surcharge', 'Additional coat required to cover dark existing color', 'sqft', 90),
  -- primers and sealing
  ('00000000-0000-4000-a000-000000000001', 'Stain-blocking primer', 'Oil or shellac based primer over water stains', 'sqft', 95),
  ('00000000-0000-4000-a000-000000000001', 'Standard primer coat', 'PVA or acrylic primer on bare or patched drywall', 'sqft', 75),
  ('00000000-0000-4000-a000-000000000001', 'Odor-sealing shellac primer', 'Shellac primer to seal smoke or moisture odor', 'sqft', 120),
  ('00000000-0000-4000-a000-000000000001', 'Ceiling water stain spot treatment', 'Spot prime and blend a single ceiling stain', 'each', 8500),
  ('00000000-0000-4000-a000-000000000001', 'Mildew surface treatment', 'Clean and treat mildew-affected surface before priming', 'sqft', 150),
  -- drywall and plaster repair
  ('00000000-0000-4000-a000-000000000001', 'Drywall patch, small', 'Patch hole under 6 inches, tape, mud, sand', 'each', 6500),
  ('00000000-0000-4000-a000-000000000001', 'Drywall patch, medium', 'Patch hole 6 to 12 inches, tape, mud, sand', 'each', 9500),
  ('00000000-0000-4000-a000-000000000001', 'Drywall patch, large', 'Patch hole over 12 inches with backing, tape, mud, sand', 'each', 14500),
  ('00000000-0000-4000-a000-000000000001', 'Drywall replacement', 'Cut out and replace damaged drywall section', 'sqft', 650),
  ('00000000-0000-4000-a000-000000000001', 'Drywall joint taping and mud', 'Tape and finish new drywall joints', 'linear_ft', 350),
  ('00000000-0000-4000-a000-000000000001', 'Skim coat walls', 'Full skim coat to level damaged or textured walls', 'sqft', 220),
  ('00000000-0000-4000-a000-000000000001', 'Texture match', 'Match existing orange peel or knockdown texture', 'sqft', 175),
  ('00000000-0000-4000-a000-000000000001', 'Minor plaster repair', 'Patch and level a small plaster-damaged area', 'each', 9500),
  ('00000000-0000-4000-a000-000000000001', 'Plaster crack repair', 'Rout, fill, and finish plaster cracks', 'linear_ft', 450),
  ('00000000-0000-4000-a000-000000000001', 'Nail pop repair', 'Reset fastener, patch, and sand', 'each', 1500),
  -- ceilings and wall coverings
  ('00000000-0000-4000-a000-000000000001', 'Popcorn ceiling removal', 'Wet scrape unpainted popcorn texture, skim ready', 'sqft', 275),
  ('00000000-0000-4000-a000-000000000001', 'Popcorn ceiling removal, painted', 'Scrape painted popcorn texture, additional labor', 'sqft', 400),
  ('00000000-0000-4000-a000-000000000001', 'Wallpaper removal, single layer', 'Strip one layer of wallpaper and wash adhesive', 'sqft', 165),
  ('00000000-0000-4000-a000-000000000001', 'Wallpaper removal, multiple layers', 'Strip layered wallpaper and wash adhesive', 'sqft', 290),
  -- trim, doors, and windows
  ('00000000-0000-4000-a000-000000000001', 'Baseboard paint', 'Sand, caulk, and paint baseboard', 'linear_ft', 250),
  ('00000000-0000-4000-a000-000000000001', 'Baseboard replacement', 'Remove and install new primed baseboard', 'linear_ft', 550),
  ('00000000-0000-4000-a000-000000000001', 'Crown molding paint', 'Sand, caulk, and paint crown molding', 'linear_ft', 300),
  ('00000000-0000-4000-a000-000000000001', 'Chair rail paint', 'Sand, caulk, and paint chair rail', 'linear_ft', 275),
  ('00000000-0000-4000-a000-000000000001', 'Window trim paint', 'Paint casing and sill on one window', 'each', 4500),
  ('00000000-0000-4000-a000-000000000001', 'Window sash paint', 'Paint operable sash on one window', 'each', 6500),
  ('00000000-0000-4000-a000-000000000001', 'Interior door paint, slab', 'Paint both sides of a flat slab door', 'each', 8500),
  ('00000000-0000-4000-a000-000000000001', 'Interior door paint, panel', 'Paint both sides of a panel door', 'each', 11000),
  ('00000000-0000-4000-a000-000000000001', 'Door frame and casing paint', 'Paint jamb and casing for one opening', 'each', 5500),
  ('00000000-0000-4000-a000-000000000001', 'Closet interior paint', 'Walls and ceiling of one standard closet', 'each', 12500),
  ('00000000-0000-4000-a000-000000000001', 'Closet shelving paint', 'Sand and paint built-in shelving', 'linear_ft', 400),
  ('00000000-0000-4000-a000-000000000001', 'Caulking, gaps and trim', 'Caulk trim joints and gaps before painting', 'linear_ft', 175),
  -- prep, protection, and cleanup
  ('00000000-0000-4000-a000-000000000001', 'Wall sanding and prep', 'Sand, degloss, and spot fill before painting', 'sqft', 55),
  ('00000000-0000-4000-a000-000000000001', 'Tape and mask', 'Mask trim, fixtures, and edges', 'sqft', 35),
  ('00000000-0000-4000-a000-000000000001', 'Plastic sheeting containment', 'Seal off work area with plastic sheeting', 'flat', 7500),
  ('00000000-0000-4000-a000-000000000001', 'Furniture moving and covering', 'Move and cover room furniture', 'flat', 9500),
  ('00000000-0000-4000-a000-000000000001', 'Floor protection', 'Drop cloths and rosin paper over flooring', 'flat', 6500),
  ('00000000-0000-4000-a000-000000000001', 'Room prep and cleanup', 'Full room prep, daily cleanup, final walkthrough', 'flat', 12500),
  ('00000000-0000-4000-a000-000000000001', 'Debris disposal', 'Haul away paint debris and stripped material', 'flat', 8500),
  -- fixtures and hardware handling
  ('00000000-0000-4000-a000-000000000001', 'Ceiling fan removal and reinstall', 'Remove and reinstall ceiling fan for ceiling work', 'each', 7500),
  ('00000000-0000-4000-a000-000000000001', 'Light fixture removal and reinstall', 'Remove and reinstall a wall or ceiling fixture', 'each', 4500),
  ('00000000-0000-4000-a000-000000000001', 'Outlet and switch plate handling', 'Remove and reinstall plates in one room', 'flat', 3500),
  ('00000000-0000-4000-a000-000000000001', 'Radiator or register paint', 'Prep and paint one radiator or register cover', 'each', 5500),
  -- exterior
  ('00000000-0000-4000-a000-000000000001', 'Exterior wall paint, 2 coats', 'Two coats exterior acrylic on siding', 'sqft', 210),
  ('00000000-0000-4000-a000-000000000001', 'Exterior trim paint', 'Paint fascia, soffit, and trim boards', 'linear_ft', 325),
  ('00000000-0000-4000-a000-000000000001', 'Exterior door paint', 'Prep and paint one exterior door and frame', 'each', 12500),
  ('00000000-0000-4000-a000-000000000001', 'Power washing prep', 'Pressure wash exterior surfaces before painting', 'sqft', 45),
  ('00000000-0000-4000-a000-000000000001', 'Exterior scrape and sand', 'Scrape loose paint and sand to sound surface', 'sqft', 125),
  ('00000000-0000-4000-a000-000000000001', 'Wood rot repair, minor', 'Cut out and fill small rot area with epoxy or dutchman', 'each', 14500),
  ('00000000-0000-4000-a000-000000000001', 'Shutter paint', 'Remove, paint, and rehang one shutter pair', 'each', 6500),
  ('00000000-0000-4000-a000-000000000001', 'Porch railing paint', 'Prep and paint railing and balusters', 'linear_ft', 600);

-- ============================================================
-- hvac template
-- ============================================================

insert into public.price_book_items (price_book_id, name, description, unit, unit_price_cents)
values
  ('00000000-0000-4000-a000-000000000002', 'Diagnostic service call', 'On-site diagnosis of heating or cooling issue', 'flat', 12500),
  ('00000000-0000-4000-a000-000000000002', 'Air filter replacement, standard', 'Replace 1-inch disposable filter', 'each', 4500),
  ('00000000-0000-4000-a000-000000000002', 'Air filter replacement, media cabinet', 'Replace 4 to 5 inch media filter', 'each', 8500),
  ('00000000-0000-4000-a000-000000000002', 'Duct cleaning', 'Clean supply or return duct run', 'linear_ft', 950),
  ('00000000-0000-4000-a000-000000000002', 'Vent register cleaning', 'Remove, clean, and reinstall one register', 'each', 3500),
  ('00000000-0000-4000-a000-000000000002', 'Duct sealing', 'Seal accessible duct joints with mastic', 'linear_ft', 1200),
  ('00000000-0000-4000-a000-000000000002', 'Duct insulation wrap', 'Wrap exposed duct in insulation', 'linear_ft', 850),
  ('00000000-0000-4000-a000-000000000002', 'Condenser coil cleaning', 'Clean outdoor condenser coil and cabinet', 'flat', 15000),
  ('00000000-0000-4000-a000-000000000002', 'Evaporator coil cleaning', 'Access and clean indoor evaporator coil', 'flat', 22500),
  ('00000000-0000-4000-a000-000000000002', 'Refrigerant recharge, R-410A', 'Recharge per pound after leak check', 'each', 9500),
  ('00000000-0000-4000-a000-000000000002', 'Thermostat install, standard', 'Replace with non-connected digital thermostat', 'each', 16500),
  ('00000000-0000-4000-a000-000000000002', 'Smart thermostat install', 'Install and configure connected thermostat', 'each', 24500),
  ('00000000-0000-4000-a000-000000000002', 'Capacitor replacement', 'Replace run or start capacitor', 'each', 22500),
  ('00000000-0000-4000-a000-000000000002', 'Contactor replacement', 'Replace condenser contactor', 'each', 19500),
  ('00000000-0000-4000-a000-000000000002', 'Blower motor replacement', 'Replace air handler blower motor', 'each', 45000),
  ('00000000-0000-4000-a000-000000000002', 'Condensate drain line flush', 'Clear and treat condensate drain line', 'flat', 9500),
  ('00000000-0000-4000-a000-000000000002', 'Condensate pump replacement', 'Replace condensate lift pump', 'each', 27500),
  ('00000000-0000-4000-a000-000000000002', 'Seasonal tune-up, cooling', 'Full cooling season inspection and service', 'flat', 14500),
  ('00000000-0000-4000-a000-000000000002', 'Seasonal tune-up, heating', 'Full heating season inspection and service', 'flat', 14500),
  ('00000000-0000-4000-a000-000000000002', 'Return air grille replacement', 'Replace damaged return grille', 'each', 8500);

-- ============================================================
-- landscaping template
-- ============================================================

insert into public.price_book_items (price_book_id, name, description, unit, unit_price_cents)
values
  ('00000000-0000-4000-a000-000000000003', 'Lawn mowing and edging', 'Mow, edge, and blow clippings', 'sqft', 2),
  ('00000000-0000-4000-a000-000000000003', 'Mulch install, 3 inch depth', 'Supply and spread hardwood mulch in beds', 'sqft', 85),
  ('00000000-0000-4000-a000-000000000003', 'Mulch bed refresh', 'Top-dress existing beds with fresh mulch', 'sqft', 55),
  ('00000000-0000-4000-a000-000000000003', 'Shrub trimming, small', 'Trim shrub under 4 feet and clean up', 'each', 1500),
  ('00000000-0000-4000-a000-000000000003', 'Shrub trimming, large', 'Trim shrub over 4 feet and clean up', 'each', 3500),
  ('00000000-0000-4000-a000-000000000003', 'Hedge trimming', 'Shape hedge line and remove trimmings', 'linear_ft', 450),
  ('00000000-0000-4000-a000-000000000003', 'Sod installation', 'Grade, install, and roll new sod', 'sqft', 220),
  ('00000000-0000-4000-a000-000000000003', 'Lawn dethatching', 'Power rake and collect thatch', 'sqft', 12),
  ('00000000-0000-4000-a000-000000000003', 'Lawn aeration', 'Core aerate established lawn', 'sqft', 8),
  ('00000000-0000-4000-a000-000000000003', 'Overseeding', 'Broadcast seed over prepared lawn', 'sqft', 10),
  ('00000000-0000-4000-a000-000000000003', 'Fertilizer application', 'Apply granular fertilizer', 'sqft', 6),
  ('00000000-0000-4000-a000-000000000003', 'Weed removal, beds', 'Hand weed planting beds', 'sqft', 45),
  ('00000000-0000-4000-a000-000000000003', 'Tree pruning, under 15 feet', 'Prune small ornamental tree from ground', 'each', 12500),
  ('00000000-0000-4000-a000-000000000003', 'Stump grinding', 'Grind stump below grade and backfill', 'each', 22500),
  ('00000000-0000-4000-a000-000000000003', 'Shrub planting, 5 gallon', 'Supply and plant 5-gallon shrub', 'each', 8500),
  ('00000000-0000-4000-a000-000000000003', 'Landscape edging install', 'Install steel or plastic bed edging', 'linear_ft', 650),
  ('00000000-0000-4000-a000-000000000003', 'Gravel path install', 'Excavate, fabric, and gravel walking path', 'sqft', 350),
  ('00000000-0000-4000-a000-000000000003', 'Leaf cleanup and haul', 'Rake, bag, and haul leaves', 'flat', 17500),
  ('00000000-0000-4000-a000-000000000003', 'Seasonal yard cleanup', 'Full spring or fall property cleanup', 'flat', 27500),
  ('00000000-0000-4000-a000-000000000003', 'Debris haul-away', 'Load and haul green waste', 'flat', 12500);
