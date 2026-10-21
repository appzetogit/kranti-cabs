import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { isGeneratedBannerTitle } from '../../../../shared/hooks/useZoneBanners';

const Motion = motion;
const LIST_PATH = '/admin/promotions/banner-image';
const CREATE_PATH = '/admin/promotions/banner-image/create';
const EDIT_PATH_PREFIX = '/admin/promotions/banner-image/edit/';

const AUDIENCE_OPTIONS = [
  { value: 'both', label: 'Rider & driver apps' },
  { value: 'rider', label: 'Rider app only' },
  { value: 'driver', label: 'Driver app only' },
];
const AUDIENCE_LABELS = { both: 'Rider & Driver', rider: 'Rider', driver: 'Driver' };

const inputClass = 'w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors';
const labelClass = 'block text-xs font-semibold text-gray-500 mb-1.5';

const createInitialFormData = () => ({
  image: null,
  image_url: '',
  use_url: false,
  title: '',
  audience: 'both',
  zone_ids: [],
});

// The rider home-screen settings keep a copy of the banners as a fallback for
// when the zone feed cannot be reached. Only banners meant for every rider
// belong in it, or a zone-targeted banner would leak to every city.
const isEveryRiderBanner = (banner) => !(banner.zone_ids || []).length && banner.audience !== 'driver';

const BannerImage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: editId } = useParams();
  const isCreateRoute = location.pathname === CREATE_PATH;
  const isEditRoute = Boolean(editId) && location.pathname.startsWith(EDIT_PATH_PREFIX);
  const isFormRoute = isCreateRoute || isEditRoute;

  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(createInitialFormData);
  const [imagePreview, setImagePreview] = useState(null);
  const [zones, setZones] = useState([]);
  const [zonesError, setZonesError] = useState('');
  const [zoneSearch, setZoneSearch] = useState('');

  // The transparent decorations shown at the very top of the app home screen,
  // stored as an array in user_home_settings.topBanners. Admins can add several
  // and delete any of them.
  const [topBanners, setTopBanners] = useState([]);
  const [topDraft, setTopDraft] = useState('');
  const [topSaving, setTopSaving] = useState(false);

  const token = localStorage.getItem('adminToken') || '';
  const baseUrl = globalThis.__LEGACY_BACKEND_ORIGIN__ + '/api/v1/admin';
  const homeSettingsUrl = `${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/admin/general-settings/user-home-management`;

  const resolveImageUrl = useCallback(
    (img) => {
      if (!img) return null;
      if (img.startsWith('data:') || img.startsWith('http')) return img;
      const rootUrl = baseUrl.replace('/api/v1/admin', '');
      return `${rootUrl}/${img.startsWith('/') ? img.slice(1) : img}`;
    },
    [baseUrl],
  );

  const syncBannersToHomeSettings = useCallback(async (bannersList) => {
    if (!token) return;
    try {
      const homeRes = await fetch(`${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/admin/general-settings/user-home-management`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!homeRes.ok) return;
      const homeData = await homeRes.json();
      const currentSettings = homeData.settings || {};

      const nextPromos = bannersList.filter(isEveryRiderBanner).map((b, idx) => ({
        id: b._id || b.id || String(idx + 1),
        title: (!isGeneratedBannerTitle(b.title) && b.title) || 'Experience A New Standard With Kranti Cabs',
        subtitle: b.subtitle || 'A premier private hire service where luxury and reliability converge.',
        imageUrl: b.image || '',
        image: b.image || '',
        route: b.redirect_url || b.external_link || b.deep_link || '/taxi/user/ride/select-location',
        status: b.active !== false ? 'active' : 'inactive',
        order: idx + 1
      }));

      const updatedSettings = {
        ...currentSettings,
        promos: nextPromos
      };

      await fetch(`${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/admin/general-settings/user-home-management`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ settings: updatedSettings })
      });
    } catch (error) {
      console.error('Failed to sync banners to home settings:', error);
    }
  }, [token]);

  // Reads the stored top banners, tolerating both the new array form and the
  // old single `topImage` field.
  const normalizeTopBanners = (settings = {}) => {
    const raw = settings.topBanners ?? settings.top_banners;
    if (Array.isArray(raw)) {
      return raw
        .map((item, idx) => {
          const image = typeof item === 'string'
            ? item
            : (item?.image || item?.imageUrl || item?.url || '');
          return image ? { id: item?.id || `tb_${idx}_${Date.now()}`, image: String(image) } : null;
        })
        .filter(Boolean);
    }
    const single = (settings.topImage || settings.top_image || '').toString();
    return single ? [{ id: 'tb_legacy', image: single }] : [];
  };

  const fetchTopBanners = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(homeSettingsUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setTopBanners(normalizeTopBanners(data.settings || {}));
    } catch (error) {
      console.error('Failed to load home top banners:', error);
    }
  }, [token, homeSettingsUrl]);

  // Read-modify-write the whole list, so we never clobber the promos the banner
  // sync writes into the same settings document.
  const persistTopBanners = useCallback(async (nextList) => {
    if (!token) return false;
    setTopSaving(true);
    try {
      const res = await fetch(homeSettingsUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res.ok ? await res.json() : { settings: {} };
      const currentSettings = data.settings || {};

      const saveRes = await fetch(homeSettingsUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          settings: {
            ...currentSettings,
            topBanners: nextList,
            // Keep the legacy single field in sync (first banner) for any app
            // build that still reads it.
            topImage: nextList[0]?.image || '',
          },
        }),
      });
      if (saveRes.ok) {
        setTopBanners(nextList);
        return true;
      }
      alert('Failed to save top banners');
      return false;
    } catch (error) {
      console.error('Save top banners error:', error);
      alert(`Network Error: ${error.message}`);
      return false;
    } finally {
      setTopSaving(false);
    }
  }, [token, homeSettingsUrl]);

  const handleTopDraftFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setTopDraft(reader.result.toString());
    reader.onerror = () => alert('Could not read the image file');
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const addTopBanner = async () => {
    const value = topDraft.trim();
    if (!value) {
      alert('Choose an image or paste an image URL first');
      return;
    }
    const next = [...topBanners, { id: `tb_${Date.now()}`, image: value }];
    const ok = await persistTopBanners(next);
    if (ok) setTopDraft('');
  };

  const deleteTopBanner = async (id) => {
    if (!window.confirm('Remove this top banner?')) return;
    await persistTopBanners(topBanners.filter((b) => b.id !== id));
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const bootstrapRes = await fetch(`${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/admin/promotions/bootstrap`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (bootstrapRes.ok) {
        const bootstrapData = await bootstrapRes.json();
        if (bootstrapData.success) {
          const items = bootstrapData.data?.banners || [];
          setBanners(items);
          syncBannersToHomeSettings(items);
          return;
        }
      }

      const res = await fetch(`${baseUrl}/banners`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const items = data.data?.results || (Array.isArray(data.data) ? data.data : data.results || []);
          setBanners(items);
          syncBannersToHomeSettings(items);
        } else {
          setBanners([]);
        }
      } else {
        setBanners([]);
      }
    } catch (error) {
      console.error('Error fetching banners:', error);
      setBanners([]);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, token, syncBannersToHomeSettings]);

  const fetchZones = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${baseUrl}/banners/zones`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load zones');
      setZones(data.data?.results || []);
      setZonesError('');
    } catch (error) {
      console.error('Failed to load zones:', error);
      setZonesError('Could not load zones. The banner will show in all zones unless you pick some.');
    }
  }, [baseUrl, token]);

  useEffect(() => {
    fetchData();
    fetchTopBanners();
    fetchZones();
  }, [fetchData, fetchTopBanners, fetchZones]);

  useEffect(() => {
    if (!isFormRoute) {
      setFormData(createInitialFormData());
      setImagePreview(null);
      setZoneSearch('');
    }
  }, [isFormRoute]);

  // Fill the form from the list once it has loaded, so a reload on the edit
  // URL works too.
  const editingBanner = useMemo(
    () => (isEditRoute ? banners.find((banner) => String(banner._id || banner.id) === String(editId)) : null),
    [isEditRoute, banners, editId],
  );
  useEffect(() => {
    if (!editingBanner) return;
    setFormData({
      ...createInitialFormData(),
      title: editingBanner.title || '',
      audience: editingBanner.audience || 'both',
      zone_ids: (editingBanner.zone_ids || []).map(String),
    });
    setImagePreview(editingBanner.image ? resolveImageUrl(editingBanner.image) : null);
  }, [editingBanner, resolveImageUrl]);

  // Zones the banner points at that are no longer listed (deleted) still need
  // a chip so the admin can see and remove them.
  const zoneOptions = useMemo(() => {
    const known = new Map(zones.map((zone) => [String(zone._id), zone]));
    (editingBanner?.zones || []).forEach((zone) => {
      if (!known.has(String(zone._id))) known.set(String(zone._id), { _id: zone._id, name: zone.name, active: false, missing: true });
    });
    return [...known.values()];
  }, [zones, editingBanner]);
  const visibleZoneOptions = useMemo(() => {
    const query = zoneSearch.trim().toLowerCase();
    return query ? zoneOptions.filter((zone) => zone.name.toLowerCase().includes(query)) : zoneOptions;
  }, [zoneOptions, zoneSearch]);

  const toggleZone = (zoneId) => {
    const id = String(zoneId);
    setFormData((current) => ({
      ...current,
      zone_ids: current.zone_ids.includes(id)
        ? current.zone_ids.filter((value) => value !== id)
        : [...current.zone_ids, id],
    }));
  };

  const rows = useMemo(() => banners, [banners]);

  const handleImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFormData((current) => ({
      ...current,
      image: file,
      use_url: false,
      image_url: '',
    }));
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSave = async (event) => {
    event.preventDefault();

    // Editing may keep the current image; creating needs one.
    const hasNewImage = formData.use_url ? Boolean(formData.image_url.trim()) : Boolean(formData.image);
    if (!isEditRoute && !formData.use_url && !formData.image) {
      alert('Please upload a banner image');
      return;
    }
    if (isEditRoute && !hasNewImage && !imagePreview) {
      alert('Please upload a banner image');
      return;
    }

    if (formData.use_url && !formData.image_url.trim()) {
      alert('Please enter an image URL');
      return;
    }

    setSaving(true);
    try {
      let imageData = formData.use_url ? formData.image_url.trim() : '';

      if (!formData.use_url && formData.image instanceof File) {
        imageData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(formData.image);
        });
      }

      const payload = {
        audience: formData.audience,
        zone_ids: formData.zone_ids,
        ...(formData.title.trim() ? { title: formData.title.trim() } : {}),
        ...(hasNewImage || !isEditRoute
          ? { image: imageData, image_url: formData.image_url.trim(), use_url: formData.use_url }
          : {}),
      };

      const res = await fetch(isEditRoute ? `${baseUrl}/banners/${editId}` : `${baseUrl}/banners`, {
        method: isEditRoute ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setFormData(createInitialFormData());
        setImagePreview(null);
        await fetchData();
        navigate(LIST_PATH);
      } else {
        alert(data.message || 'Failed to save banner');
      }
    } catch (error) {
      console.error('Save banner error:', error);
      alert(`Network Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this banner?')) return;

    try {
      const res = await fetch(`${baseUrl}/banners/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        await fetchData();
      }
    } catch (error) {
      console.error('Delete banner error:', error);
    }
  };

  const toggleStatus = async (item) => {
    const id = item._id || item.id;
    try {
      const res = await fetch(`${baseUrl}/banners/${id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ active: !item.active }),
      });
      const data = await res.json();
      if (data.success) {
        setBanners((current) => {
          const nextBanners = current.map((banner) => ((banner._id || banner.id) === id ? { ...banner, active: !item.active } : banner));
          syncBannersToHomeSettings(nextBanners);
          return nextBanners;
        });
      }
    } catch (error) {
      console.error('Banner status toggle error:', error);
    }
  };

  return (
    <div className="space-y-6 p-1 animate-in fade-in duration-500 font-sans text-gray-950 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[17px] font-black text-[#2D3A6E] uppercase tracking-tight italic leading-none mb-1">
            {isEditRoute ? 'EDIT' : isCreateRoute ? 'CREATE' : 'BANNER IMAGE'}
          </h1>
          <div className="flex items-center gap-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest leading-none">
            <span>Banner Image</span>
            <ChevronRight size={12} className="opacity-50" />
            <span className="text-gray-900">{isEditRoute ? 'Edit' : isCreateRoute ? 'Create' : 'Banner Image'}</span>
          </div>
        </div>
        {isFormRoute ? (
          <button
            type="button"
            onClick={() => navigate(LIST_PATH)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft size={16} /> Back
          </button>
        ) : null}
      </div>

      <AnimatePresence mode="wait">
        {!isFormRoute ? (
          <Motion.div
            key="banner-list"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Home Top Banners — transparent decorations pinned to the very
                top of the app home screen (festival garland, lights, ...).
                Add as many as you like; the app cross-fades between them. */}
            <div className="bg-white rounded-[22px] border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-[15px] font-black text-[#2D3A6E] uppercase tracking-tight italic leading-none">
                    Home Top Banners
                  </h2>
                  <p className="text-[11px] font-semibold text-gray-400 mt-1">
                    Transparent PNGs shown at the very top of the app home page. Add several — the app rotates through them.
                  </p>
                </div>
              </div>

              {/* Add a new top banner */}
              <div className="flex flex-col gap-4 md:flex-row md:items-start">
                <div className="w-full md:w-72 shrink-0">
                  <div className="rounded-xl overflow-hidden border border-gray-200" style={{ background: '#0D1B2A' }}>
                    {topDraft ? (
                      <img
                        src={resolveImageUrl(topDraft)}
                        alt="New top banner"
                        className="w-full object-contain"
                        style={{ maxHeight: 120 }}
                      />
                    ) : (
                      <div className="h-24 flex items-center justify-center text-gray-500 text-xs gap-2">
                        <ImageIcon size={16} /> Preview
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                      <input type="file" className="hidden" accept="image/png,image/webp,image/*" onChange={handleTopDraftFile} />
                      <Upload size={16} /> Choose Image
                    </label>
                    {topDraft ? (
                      <button
                        type="button"
                        onClick={() => setTopDraft('')}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                      >
                        <Trash2 size={15} /> Clear
                      </button>
                    ) : null}
                  </div>

                  <div>
                    <label className="block text-[13px] font-semibold text-gray-900 mb-1">Or paste an image URL</label>
                    <input
                      type="url"
                      value={topDraft.startsWith('data:') ? '' : topDraft}
                      onChange={(e) => setTopDraft(e.target.value)}
                      placeholder="https://example.com/garland.png"
                      className="w-full max-w-xl border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>

                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={addTopBanner}
                      disabled={topSaving || !topDraft.trim()}
                      className="h-10 px-6 bg-[#2D3A6E] text-white rounded-lg text-[13px] font-bold hover:bg-[#1d2756] transition-all inline-flex items-center gap-2 disabled:opacity-60"
                    >
                      {topSaving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                      Add Top Banner
                    </button>
                  </div>
                </div>
              </div>

              {/* Existing top banners with per-item delete */}
              <div className="mt-6 border-t border-gray-100 pt-5">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">
                  Added top banners ({topBanners.length})
                </p>
                {topBanners.length === 0 ? (
                  <p className="text-sm text-gray-400">No top banners yet. Add one above.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {topBanners.map((b, idx) => (
                      <div key={b.id} className="rounded-xl border border-gray-200 overflow-hidden">
                        <div style={{ background: '#0D1B2A' }} className="flex items-center justify-center">
                          <img
                            src={resolveImageUrl(b.image)}
                            alt={`Top banner ${idx + 1}`}
                            className="w-full object-contain"
                            style={{ maxHeight: 110 }}
                          />
                        </div>
                        <div className="flex items-center justify-between px-3 py-2 bg-white">
                          <span className="text-[11px] font-bold text-gray-500">#{idx + 1}</span>
                          <button
                            type="button"
                            onClick={() => deleteTopBanner(b.id)}
                            disabled={topSaving}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-bold text-rose-600 bg-white border border-rose-200 rounded-lg hover:bg-rose-50 disabled:opacity-60"
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-[22px] border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-6 flex items-center justify-between border-b border-gray-100">
                <div className="flex items-center gap-3 text-sm text-gray-500">
                  <span>show</span>
                  <select className="bg-white border border-gray-200 rounded-md px-2 py-1 text-[13px] font-medium outline-none">
                    <option>10</option>
                    <option>25</option>
                    <option>50</option>
                  </select>
                  <span>entries</span>
                </div>

                <button
                  type="button"
                  onClick={() => navigate(CREATE_PATH)}
                  className="bg-[#2D3A6E] text-white h-10 px-5 rounded-lg flex items-center gap-2 text-[13px] font-bold hover:bg-[#1d2756] transition-all"
                >
                  <Plus size={16} />
                  Add Banner Image
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50">
                    <tr className="text-[13px] font-bold text-gray-700">
                      <th className="px-6 py-4">Icon</th>
                      <th className="px-6 py-4">Shown in</th>
                      <th className="px-6 py-4">Zones</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loading ? (
                      <tr>
                        <td colSpan="5" className="px-6 py-14 text-center text-sm text-gray-400">
                          Loading banners...
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="px-6 py-14 text-center text-sm text-gray-400">
                          No banners found.
                        </td>
                      </tr>
                    ) : (
                      rows.map((item) => (
                        <tr key={item._id || item.id}>
                          <td className="px-6 py-4">
                            <div className="h-10 w-52 overflow-hidden rounded border border-gray-200 bg-white">
                              {item.image ? (
                                <img
                                  src={resolveImageUrl(item.image)}
                                  alt="Banner"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center text-gray-300">
                                  <ImageIcon size={16} />
                                </div>
                              )}
                            </div>
                            {item.title && !isGeneratedBannerTitle(item.title) ? (
                              <p className="mt-1.5 max-w-52 truncate text-[12px] font-semibold text-gray-700">{item.title}</p>
                            ) : null}
                          </td>
                          <td className="px-6 py-4">
                            <span className="inline-flex whitespace-nowrap rounded bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700">
                              {AUDIENCE_LABELS[item.audience] || AUDIENCE_LABELS.both}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {(item.zones || []).length === 0 ? (
                              <span className="inline-flex whitespace-nowrap rounded bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                                All zones
                              </span>
                            ) : (
                              <div className="flex max-w-xs flex-wrap gap-1.5">
                                {item.zones.map((zone) => (
                                  <span
                                    key={zone._id}
                                    title={zone.exists === false ? 'This zone was deleted. Edit the banner to remove it.' : undefined}
                                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-bold ${
                                      zone.exists === false ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-700'
                                    }`}
                                  >
                                    <MapPin size={11} /> {zone.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <button
                              type="button"
                              onClick={() => toggleStatus(item)}
                              className={`inline-flex rounded px-2.5 py-1 text-[11px] font-bold uppercase ${
                                item.active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
                              }`}
                            >
                              {item.active ? 'Active' : 'Inactive'}
                            </button>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label="Edit banner"
                                onClick={() => navigate(`${EDIT_PATH_PREFIX}${item._id || item.id}`)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-indigo-600"
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                type="button"
                                aria-label="Delete banner"
                                onClick={() => handleDelete(item._id || item.id)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-rose-600"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="p-6 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
                <span>
                  Showing {rows.length > 0 ? 1 : 0} to {rows.length} of {rows.length} entries
                </span>
                <div className="flex items-center gap-2">
                  <button className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-400" disabled>
                    Prev
                  </button>
                  <button className="px-4 py-2 rounded-lg bg-[#2D3A6E] text-white">1</button>
                  <button className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-400" disabled>
                    Next
                  </button>
                </div>
              </div>
            </div>
          </Motion.div>
        ) : (
          <Motion.form
            key="banner-create"
            onSubmit={handleSave}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-[22px] border border-gray-200 shadow-sm p-8"
          >
            <div className="space-y-6 max-w-3xl">
              <div>
                <label className="block text-[14px] font-semibold text-gray-900 mb-3">
                  Banner Image<span className="text-rose-500">*</span>
                  <span className="text-gray-400 font-medium">(500px x 100px)</span>
                </label>

                <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-4">
                  {imagePreview ? (
                    <div className="space-y-4">
                      <img
                        src={imagePreview}
                        alt="Banner preview"
                        className="h-28 w-full rounded-lg border border-gray-200 object-contain bg-gray-50"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setImagePreview(null);
                          setFormData((current) => ({ ...current, image: null }));
                        }}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Remove Image
                      </button>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-3 py-6 text-center">
                      <input type="file" className="hidden" accept="image/*" onChange={handleImageChange} />
                      <span className="text-[22px] text-gray-500">
                        <Upload size={28} />
                      </span>
                      <div>
                        <p className="text-[15px] font-medium text-gray-900">Upload Image</p>
                      </div>
                    </label>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <label className="inline-flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={formData.use_url}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setFormData((current) => ({
                        ...current,
                        use_url: checked,
                        image: checked ? null : current.image,
                      }));
                      if (checked) {
                        setImagePreview(null);
                      }
                    }}
                    className="rounded border-gray-300 text-[#2D3A6E] focus:ring-[#2D3A6E]"
                  />
                  <span>Use image URL</span>
                </label>

                {formData.use_url ? (
                  <div>
                    <label className="block text-[14px] font-semibold text-gray-900 mb-2">Image URL</label>
                    <input
                      type="url"
                      value={formData.image_url}
                      onChange={(e) => setFormData((current) => ({ ...current, image_url: e.target.value }))}
                      className="w-full max-w-xl border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
                      placeholder="https://example.com/banner.jpg"
                    />
                  </div>
                ) : null}
              </div>

              <div>
                <label className={labelClass} htmlFor="banner-title">Title (optional)</label>
                <input
                  id="banner-title"
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData((current) => ({ ...current, title: e.target.value }))}
                  className={`${inputClass} max-w-xl`}
                  placeholder="Diwali offer - Indore"
                />
              </div>

              <div className="rounded-xl border border-gray-200 p-6">
                <div className="flex items-center gap-3 mb-5 pb-4 border-b border-gray-100">
                  <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <Users size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Who sees it</h3>
                    <p className="text-xs text-gray-400">Pick the app and the zones. No zones selected means every zone.</p>
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <label className={labelClass} htmlFor="banner-audience">Show in</label>
                    <select
                      id="banner-audience"
                      value={formData.audience}
                      onChange={(e) => setFormData((current) => ({ ...current, audience: e.target.value }))}
                      className={`${inputClass} max-w-xs`}
                    >
                      {AUDIENCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3 mb-1.5 max-w-xl">
                      <span className="text-xs font-semibold text-gray-500">
                        <MapPin size={12} className="inline mr-1 text-gray-400" />
                        Zones
                      </span>
                      {formData.zone_ids.length ? (
                        <button
                          type="button"
                          onClick={() => setFormData((current) => ({ ...current, zone_ids: [] }))}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                        >
                          Clear ({formData.zone_ids.length})
                        </button>
                      ) : null}
                    </div>
                    <p className="text-xs text-gray-500 mb-3">
                      {formData.zone_ids.length === 0
                        ? 'Showing in all zones.'
                        : `Showing only to people currently in ${formData.zone_ids.length === 1 ? 'this zone' : `these ${formData.zone_ids.length} zones`}. A city zone inside a bigger zone (such as "India") counts as being in both.`}
                    </p>
                    {zoneOptions.length > 8 ? (
                      <input
                        type="search"
                        value={zoneSearch}
                        onChange={(e) => setZoneSearch(e.target.value)}
                        className={`${inputClass} max-w-xs mb-3`}
                        placeholder="Search zones"
                      />
                    ) : null}
                    {zonesError ? <p className="text-xs font-semibold text-rose-600 mb-2">{zonesError}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      {visibleZoneOptions.map((zone) => {
                        const selected = formData.zone_ids.includes(String(zone._id));
                        return (
                          <button
                            key={zone._id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => toggleZone(zone._id)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                              selected
                                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <MapPin size={14} />
                            {zone.name || 'Unnamed zone'}
                            {zone.missing ? <span className="text-[11px] text-rose-500">(deleted)</span> : null}
                            {!zone.missing && zone.active === false ? <span className="text-[11px] text-gray-400">(inactive)</span> : null}
                          </button>
                        );
                      })}
                      {!zonesError && zoneOptions.length === 0 ? (
                        <p className="text-sm text-gray-400">No zones set up yet.</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="h-10 px-6 bg-[#2D3A6E] text-white rounded-lg text-[13px] font-bold hover:bg-[#1d2756] transition-all inline-flex items-center gap-2 disabled:opacity-60"
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                Save
              </button>
            </div>
          </Motion.form>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BannerImage;
