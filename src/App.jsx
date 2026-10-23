import React, {
  useState,
  useEffect,
  useContext,
  createContext,
  useRef,
} from "react";
import { api, money, time, steps, labels, requestKey } from "./api";
import Icon from "./icons";
const Context = createContext(null);
const useApp = () => useContext(Context);
const cx = (...parts) => parts.filter(Boolean).join(" ");
function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return {
    busy,
    error,
    run: async (fn) => {
      if (busy) return;
      setBusy(true);
      setError("");
      try {
        return await fn();
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
  };
}
function ErrorText({ children }) {
  return children ? (
    <div className="error" role="alert">
      <Icon name="info" size={17} />
      {children}
    </div>
  ) : null;
}
function Empty({ icon = "bag", title, text, action }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={38} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading">
      <span className="spinner" />
      Getting everything ready…
    </div>
  );
}
function Status({ status }) {
  return <span className={`status ${status}`}>{labels[status] || status}</span>;
}
function Button({ children, variant = "", className = "", ...props }) {
  return (
    <button className={cx("btn", variant, className)} {...props}>
      {children}
    </button>
  );
}
function Field({ label, children, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children || <input {...props} />}
    </label>
  );
}

export default function App() {
  const [cfg, setCfg] = useState(null),
    [user, setUser] = useState(null),
    [restaurants, setRestaurants] = useState([]),
    [menu, setMenu] = useState([]),
    [cart, setCart] = useState([]),
    [favorites, setFavorites] = useState([]),
    [addresses, setAddresses] = useState([]),
    [coupon, setCoupon] = useState(""),
    [quote, setQuote] = useState(null),
    [quoteError, setQuoteError] = useState("");
  const [route, setRoute] = useState(location.hash.slice(2) || "home"),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [initError, setInitError] = useState(""),
    [restaurantId, setRestaurantId] = useState("ember");
  const notify = (message) => setToast(message);
  const go = (path) => {
    location.hash = "/" + path;
    setRoute(path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const loadCatalog = async () => {
    const [r, m] = await Promise.all([api("/restaurants"), api("/menu")]);
    setRestaurants(r.restaurants);
    setMenu(m.items);
  };
  const refreshCart = async () => {
    const data = await api("/cart");
    setCart(data.items);
    return data.items;
  };
  const loadCustomer = async () => {
    const [c, f, a] = await Promise.all([
      api("/cart"),
      api("/favorites"),
      api("/addresses"),
    ]);
    setCart(c.items);
    setFavorites(f.items);
    setAddresses(a.addresses);
  };
  useEffect(() => {
    Promise.all([
      api("/config"),
      api("/auth/me"),
      api("/restaurants"),
      api("/menu"),
    ])
      .then(([c, u, r, m]) => {
        setCfg(c);
        setUser(u.user);
        setRestaurants(r.restaurants);
        setMenu(m.items);
      })
      .catch((e) => setInitError(e.message));
    const fn = () => setRoute(location.hash.slice(2) || "home");
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    if (user?.role === "customer")
      loadCustomer().catch((e) => notify(e.message));
    else {
      setCart([]);
      setFavorites([]);
      setAddresses([]);
      setCoupon("");
    }
  }, [user?.id]);
  useEffect(() => {
    let live = true;
    if (user?.role === "customer" && cart.length)
      api("/cart/quote", { method: "POST", body: { coupon } })
        .then((q) => {
          if (live) {
            setQuote(q);
            setQuoteError("");
          }
        })
        .catch((e) => {
          if (live) {
            setQuote(null);
            setQuoteError(e.message);
          }
        });
    else {
      setQuote(null);
      setQuoteError("");
    }
    return () => {
      live = false;
    };
  }, [cart, coupon, user?.id]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  const act = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      notify(e.message);
      return undefined;
    }
  };
  const requireCustomer = (fn) => {
    if (!user) {
      setModal({ type: "auth" });
      return;
    }
    if (user.role !== "customer") {
      notify("Use a customer account to place an order.");
      return;
    }
    fn();
  };
  const toggleFavorite = (item) =>
    requireCustomer(() =>
      act(async () => {
        const saved = favorites.some((x) => x.id === item.id);
        await api(`/favorites/${item.id}`, {
          method: saved ? "DELETE" : "POST",
          body: {},
        });
        setFavorites(
          saved
            ? favorites.filter((x) => x.id !== item.id)
            : [...favorites, item],
        );
      }),
    );
  const logout = () =>
    act(async () => {
      await api("/auth/logout", { method: "POST", body: {} });
      setUser(null);
      go("home");
      notify("You have signed out.");
    });
  const ctx = {
    cfg,
    user,
    setUser,
    restaurants,
    menu,
    cart,
    setCart,
    favorites,
    addresses,
    setAddresses,
    coupon,
    setCoupon,
    quote,
    quoteError,
    restaurantId,
    setRestaurantId,
    modal,
    setModal,
    notify,
    go,
    act,
    refreshCart,
    loadCustomer,
    loadCatalog,
    requireCustomer,
    toggleFavorite,
    logout,
  };
  if (initError)
    return (
      <div className="fatal">
        <h1>Let’s reconnect.</h1>
        <p>{initError}</p>
        <Button onClick={() => location.reload()}>Try again</Button>
        <p>Make sure the FoodLane server is running.</p>
      </div>
    );
  if (!cfg) return <Loading />;
  const view = route.split("/")[0],
    orderId = route.split("/")[1];
  return (
    <Context.Provider value={ctx}>
      <div className="app">
        <Sidebar view={view} />
        <div className="workspace">
          <Header />
          <main className={cx("page", view === "home" ? "page-home" : "")}>
            {view === "home" ? (
              <Home />
            ) : view === "favorites" ? (
              <Favorites />
            ) : view === "profile" ? (
              <Profile />
            ) : view === "orders" ? (
              <Orders />
            ) : view === "order" && orderId ? (
              <OrderDetail orderId={orderId} />
            ) : view === "admin" ? (
              <Admin />
            ) : view === "driver" ? (
              <Driver />
            ) : (
              <Home />
            )}
          </main>
          <footer className="site-footer">
            <span>Made for your next good bite.</span>
            <span>FoodLane {cfg.demo && "· Local demo"}</span>
          </footer>
        </div>
        <MobileNav view={view} />
        {cart.length > 0 && view === "home" && (
          <button
            className="mobile-cart"
            onClick={() => setModal({ type: "cart" })}
          >
            <span>
              <Icon name="bag" />
              {cart.reduce((s, x) => s + x.quantity, 0)} items
            </span>
            <b>
              View cart ·{" "}
              {money(cart.reduce((s, x) => s + x.quantity * x.unit_cents, 0))}
            </b>
            <Icon name="arrow" />
          </button>
        )}
        {modal && <Modal data={modal} />}
        {toast && (
          <div className="toast" role="status">
            <Icon name="check" />
            {toast}
            <button
              className="icon-btn"
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
      </div>
    </Context.Provider>
  );
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-symbol">
        <Icon name="bag" size={25} />
      </span>
      <span>
        foodlane<span className="orange">.</span>
      </span>
    </div>
  );
}
function Sidebar({ view }) {
  const { user, go, logout, setModal } = useApp();
  const links =
    user?.role === "admin"
      ? [
          ["admin", "grid", "Dashboard"],
          ["orders", "receipt", "All orders"],
          ["home", "home", "Browse menu"],
          ["profile", "user", "My profile"],
        ]
      : user?.role === "driver"
        ? [
            ["driver", "bike", "My deliveries"],
            ["orders", "receipt", "Order history"],
            ["profile", "user", "My profile"],
          ]
        : [
            ["home", "home", "Discover"],
            ["orders", "receipt", "My orders"],
            ["favorites", "heart", "My favorites"],
            ["profile", "user", "My profile"],
          ];
  return (
    <aside className="sidebar">
      <button
        className="brand-button"
        onClick={() =>
          go(
            user?.role === "admin"
              ? "admin"
              : user?.role === "driver"
                ? "driver"
                : "home",
          )
        }
      >
        <Brand />
      </button>
      <div className="nav-label">YOUR EVERYDAY DELICIOUS</div>
      <nav>
        {links.map(([path, icon, label]) => (
          <button
            key={path}
            className={cx("nav-item", view === path && "active")}
            onClick={() => go(path)}
          >
            <Icon name={icon} />
            {label}
            {view === path && <i />}
          </button>
        ))}
      </nav>
      <div className="sidebar-promo">
        <span className="promo-icon">
          <Icon name="ticket" size={27} />
        </span>
        <h3>
          A little treat
          <br />
          on us.
        </h3>
        <p>
          20% off your first order.
          <br />
          Good food, better deal.
        </p>
        <button
          onClick={() => {
            go("home");
            setModal({ type: user?.role === "customer" ? "coupons" : "auth" });
          }}
        >
          WELCOME20 <Icon name="arrow" size={16} />
        </button>
      </div>
      <div className="sidebar-bottom">
        <span className="mini-leaf">
          <Icon name="leaf" size={17} /> Fresh from local kitchens
        </span>
        {user ? (
          <button className="nav-item" onClick={logout}>
            <Icon name="logout" />
            Sign out
          </button>
        ) : (
          <button
            className="nav-item"
            onClick={() => setModal({ type: "auth" })}
          >
            <Icon name="user" />
            Sign in
          </button>
        )}
      </div>
    </aside>
  );
}
function Header() {
  const { user, addresses, go, setModal } = useApp();
  return (
    <header className="topbar">
      <div className="mobile-brand">
        <Brand />
      </div>
      <button
        className="delivery-address"
        onClick={() => (user ? go("profile") : setModal({ type: "auth" }))}
      >
        <span className="location-icon">
          <Icon name="pin" />
        </span>
        <span>
          <small>DELIVER TO</small>
          <strong>
            {addresses[0]
              ? `${addresses[0].label} · ${addresses[0].city}`
              : "Dehradun, Uttarakhand"}
          </strong>
        </span>
        <Icon name="down" size={15} />
      </button>
      <div className="top-right">
        <span className="delivery-promise">
          <i /> A good meal is on its way
        </span>
        <button
          className="user-pill"
          onClick={() => (user ? go("profile") : setModal({ type: "auth" }))}
        >
          <span className="avatar">
            {user ? (
              user.name.slice(0, 1).toUpperCase()
            ) : (
              <Icon name="user" size={18} />
            )}
          </span>
          <span>{user ? user.name.split(" ")[0] : "Sign in"}</span>
          <Icon name="down" size={14} />
        </button>
      </div>
    </header>
  );
}
function MobileNav({ view }) {
  const { user, go } = useApp();
  const links =
    user?.role === "admin"
      ? [
          ["admin", "grid", "Dashboard"],
          ["orders", "receipt", "Orders"],
          ["home", "home", "Menu"],
          ["profile", "user", "Profile"],
        ]
      : user?.role === "driver"
        ? [
            ["driver", "bike", "Deliveries"],
            ["orders", "receipt", "Orders"],
            ["profile", "user", "Profile"],
          ]
        : [
            ["home", "home", "Home"],
            ["orders", "receipt", "Orders"],
            ["favorites", "heart", "My list"],
            ["profile", "user", "Profile"],
          ];
  return (
    <nav className="mobile-nav">
      {links.map(([path, icon, label]) => (
        <button
          key={path}
          className={view === path ? "active" : ""}
          onClick={() => go(path)}
        >
          <Icon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function Home() {
  const { restaurants, menu, restaurantId, setRestaurantId, user, setModal } =
    useApp();
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("All"),
    [veg, setVeg] = useState(false),
    [tab, setTab] = useState("Order"),
    [details, setDetails] = useState(null);
  const r = restaurants.find((x) => x.id === restaurantId) || restaurants[0];
  useEffect(() => {
    setCategory("All");
    setTab("Order");
    setDetails(null);
    if (r)
      api(`/restaurants/${r.id}`)
        .then(setDetails)
        .catch(() => {});
  }, [r?.id]);
  if (!r)
    return <Empty title="No restaurants yet" text="Please check back soon." />;
  const items = menu.filter((x) => x.restaurant_id === r.id),
    categories = ["All", ...new Set(items.map((x) => x.category))];
  const visible = items.filter(
    (x) =>
      (category === "All" || x.category === category) &&
      (!veg || x.vegetarian) &&
      `${x.name} ${x.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="home-layout">
      <section className="food-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">HUNGRY? YOU’RE IN THE RIGHT PLACE.</p>
            <h1>
              Your next good bite<span className="orange">.</span>
            </h1>
          </div>
          <span className="small-label">3 neighborhood kitchens</span>
        </div>
        <div className="restaurant-switch" aria-label="Choose restaurant">
          {restaurants.map((x) => (
            <button
              key={x.id}
              className={cx("restaurant-chip", x.id === r.id && "selected")}
              onClick={() => setRestaurantId(x.id)}
            >
              <img src={x.image} alt="" />
              <span>{x.name}</span>
              {x.id === r.id && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
        <div
          className="hero"
          style={{
            backgroundImage: `linear-gradient(90deg,rgba(17,17,13,.88),rgba(17,17,13,.07)),url(${r.image})`,
          }}
        >
          <div className="hero-content">
            <span className="hero-label">
              <i /> MADE FRESH, JUST FOR YOU
            </span>
            <h2>{r.name}</h2>
            <p>{r.cuisine}</p>
            <div className="hero-badges">
              <span>
                <Icon name="clock" size={15} />
                {r.eta} min
              </span>
              <span>
                <Icon name="bike" size={16} />
                {money(r.delivery_cents)} delivery
              </span>
            </div>
          </div>
          <span className="hero-seal">
            GOOD FOOD
            <br />
            <b>good mood.</b>
          </span>
        </div>
        <div className="restaurant-bar">
          <span>
            <Icon name="star" size={17} />
            <b>{r.review_count ? r.rating.toFixed(1) : "New kitchen"}</b>
            <small>
              {r.review_count
                ? `${r.review_count} reviews`
                : "Be the first to review"}
            </small>
          </span>
          <span className="open-status">
            <i /> Taking orders
          </span>
          <button onClick={() => setTab("Information")}>
            Restaurant info <Icon name="info" size={16} />
          </button>
        </div>
        <div className="tabs">
          {["Order", "Reviews", "Information"].map((x) => (
            <button
              key={x}
              className={tab === x ? "active" : ""}
              onClick={() => setTab(x)}
            >
              {x}
              {x === "Reviews" && r.review_count > 0 && (
                <small>{r.review_count}</small>
              )}
            </button>
          ))}
        </div>
        {tab === "Order" ? (
          <>
            <div className="menu-header">
              <h2>Something for every craving</h2>
              <label className="search">
                <Icon name="search" size={18} />
                <input
                  placeholder="Search this menu…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search menu"
                />
              </label>
            </div>
            <div className="filters">
              <div className="category-list">
                {categories.map((x) => (
                  <button
                    key={x}
                    className={cx("category", category === x && "active")}
                    onClick={() => setCategory(x)}
                  >
                    {x === "All" ? <Icon name="grid" size={15} /> : null}
                    {x}
                  </button>
                ))}
              </div>
              <label className="veg-toggle">
                <input
                  type="checkbox"
                  checked={veg}
                  onChange={(e) => setVeg(e.target.checked)}
                />
                <span />
                <Icon name="leaf" size={14} /> Veg
              </label>
            </div>
            <div className="menu-grid">
              {visible.map((x) => (
                <FoodCard key={x.id} item={x} />
              ))}
            </div>
            {!visible.length && (
              <Empty
                icon="search"
                title="No bites found"
                text="Try another search or category."
              />
            )}
            <div className="fresh-note">
              <Icon name="leaf" />
              <div>
                <b>Good ingredients. Great food.</b>
                <p>Every order is made fresh in your neighborhood kitchen.</p>
              </div>
            </div>
          </>
        ) : tab === "Information" ? (
          <div className="info-panel">
            <h2>A little about us</h2>
            <p>{r.description}</p>
            <div className="info-row">
              <Icon name="pin" />
              <div>
                <b>Find us</b>
                <p>{r.address}</p>
              </div>
            </div>
            <div className="info-row">
              <Icon name="clock" />
              <div>
                <b>Kitchen hours</b>
                <p>{r.hours}</p>
                <small>Hours shown are sample business information.</small>
              </div>
            </div>
            <div className="info-row">
              <Icon name="bike" />
              <div>
                <b>Delivery</b>
                <p>
                  {r.eta} minutes estimated · Free delivery on food totals of
                  ₹599 or more
                </p>
              </div>
            </div>
            <div className="note">
              Photos are illustrative. Ask the kitchen about allergens before
              placing an order.
            </div>
          </div>
        ) : (
          <div className="reviews">
            {details?.reviews?.length ? (
              details.reviews.map((v, i) => (
                <div className="review" key={i}>
                  <div className="avatar">{v.name[0]}</div>
                  <div>
                    <b>{v.name}</b>
                    <div className="stars">
                      {"★".repeat(v.rating)}
                      <span>{"★".repeat(5 - v.rating)}</span>
                    </div>
                    <p>{v.body || "Enjoyed the meal!"}</p>
                    <small>{time(v.created_at)}</small>
                  </div>
                </div>
              ))
            ) : (
              <Empty
                icon="star"
                title="Your opinion belongs here"
                text="Order a meal and share your experience after delivery."
              />
            )}
          </div>
        )}
      </section>
      <aside className="cart-aside">
        <CartPanel />
        <div className="delivery-card">
          <span>
            <Icon name="shield" size={24} />
          </span>
          <div>
            <b>A little care in every order</b>
            <p>
              Freshly made. Carefully packed.
              <br />
              Ready for your doorstep.
            </p>
          </div>
        </div>
        {!user && (
          <button
            className="subtle-link"
            onClick={() => setModal({ type: "auth" })}
          >
            Sign in to save your favorites <Icon name="arrow" size={14} />
          </button>
        )}
      </aside>
    </div>
  );
}
function FoodCard({ item }) {
  const { favorites, toggleFavorite, setModal } = useApp();
  return (
    <article className={cx("food-card", !item.available && "unavailable")}>
      <div className="food-image">
        <button
          className="image-open"
          aria-label={`Customize ${item.name}`}
          onClick={() => setModal({ type: "food", item })}
        >
          <img src={item.image} alt={item.name} loading="lazy" />
        </button>
        {item.vegetarian && (
          <span className="veg-badge">
            <i /> VEG
          </span>
        )}
        <button
          className={cx(
            "favorite-button",
            favorites.some((x) => x.id === item.id) && "saved",
          )}
          aria-label={`${favorites.some((x) => x.id === item.id) ? "Remove" : "Save"} ${item.name}`}
          onClick={() => toggleFavorite(item)}
        >
          <Icon name="heart" size={17} />
        </button>
        {!item.available && (
          <span className="sold-out">Currently unavailable</span>
        )}
      </div>
      <div className="food-card-body">
        <button
          className="food-name"
          onClick={() => setModal({ type: "food", item })}
        >
          {item.name}
        </button>
        <p>{item.description}</p>
        <div className="food-card-bottom">
          <b>{money(item.price_cents)}</b>
          <button
            className="add-button"
            disabled={!item.available}
            aria-label={`Add ${item.name}`}
            onClick={() => setModal({ type: "food", item })}
          >
            Add <Icon name="plus" size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}
function CartPanel({ full = false }) {
  const {
    cart,
    setCart,
    quote,
    quoteError,
    coupon,
    setCoupon,
    setModal,
    act,
    user,
    requireCustomer,
  } = useApp();
  const [busy, setBusy] = useState(false);
  async function change(item, quantity) {
    if (busy) return;
    setBusy(true);
    await act(async () => {
      const data = await api(`/cart/${item.id}`, {
        method: quantity ? "PATCH" : "DELETE",
        body: quantity ? { quantity } : {},
      });
      setCart(data.items);
    });
    setBusy(false);
  }
  return (
    <div className={cx("cart-panel", full && "cart-full")}>
      <div className="cart-title">
        <div>
          <h2>
            Your cart <span>{cart.reduce((s, x) => s + x.quantity, 0)}</span>
          </h2>
          <p>A good meal starts here.</p>
        </div>
        <Icon name="bag" size={23} />
      </div>
      {cart.length ? (
        <>
          <div className="cart-restaurant">
            <Icon name="home" size={16} />
            {cart[0].restaurant_name}
          </div>
          <div className="cart-items">
            {cart.map((x) => (
              <div className="cart-item" key={x.id}>
                <img src={x.image} alt="" />
                <div className="cart-item-info">
                  <b>{x.name}</b>
                  <small>
                    {x.size_label}
                    {x.sauce !== "none" ? ` · ${x.sauce_label}` : ""}
                  </small>
                  {x.note && <small className="item-note">{x.note}</small>}
                  {!x.available && (
                    <small className="danger-text">
                      Unavailable — remove to continue
                    </small>
                  )}
                  <div className="cart-item-bottom">
                    <strong>{money(x.unit_cents * x.quantity)}</strong>
                    <div className="qty">
                      <button
                        disabled={busy}
                        aria-label={`Remove one ${x.name}`}
                        onClick={() => change(x, x.quantity - 1)}
                      >
                        <Icon
                          name={x.quantity === 1 ? "trash" : "minus"}
                          size={12}
                        />
                      </button>
                      <span>{x.quantity}</span>
                      <button
                        disabled={busy || x.quantity >= 20}
                        aria-label={`Add one ${x.name}`}
                        onClick={() => change(x, x.quantity + 1)}
                      >
                        <Icon name="plus" size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            className="coupon-button"
            onClick={() => setModal({ type: "coupons" })}
          >
            <Icon name="ticket" />
            <span>
              {coupon ? `${coupon} applied` : "Got a little discount?"}
              <small>
                {coupon
                  ? "Tap to change your offer"
                  : "Explore offers & promo codes"}
              </small>
            </span>
            <Icon name="chevron" size={16} />
          </button>
          {coupon && (
            <button className="text-button small" onClick={() => setCoupon("")}>
              Remove coupon
            </button>
          )}
          <ErrorText>{quoteError}</ErrorText>
          {quote ? (
            <PriceSummary quote={quote} />
          ) : (
            !quoteError && <p className="muted">Updating total…</p>
          )}
          <Button
            className="wide"
            disabled={!quote || busy}
            onClick={() => setModal({ type: "checkout" })}
          >
            Continue to checkout <Icon name="arrow" size={17} />
          </Button>
          <button
            className="text-button small clear-cart"
            onClick={() =>
              setModal({
                type: "confirm",
                title: "Clear your cart?",
                text: "All items in this cart will be removed.",
                onConfirm: async () => {
                  await api("/cart", { method: "DELETE", body: {} });
                  setCart([]);
                  setCoupon("");
                },
              })
            }
          >
            Clear cart
          </button>
          <p className="cart-caption">
            <Icon name="shield" size={12} /> Your order, freshly prepared
          </p>
        </>
      ) : (
        <Empty
          icon="bag"
          title="A little empty in here"
          text="Find something delicious on the menu and make it yours."
          action={
            !user ? (
              <button
                className="text-button"
                onClick={() => requireCustomer(() => {})}
              >
                Sign in to order <Icon name="arrow" size={14} />
              </button>
            ) : null
          }
        />
      )}
    </div>
  );
}
function PriceSummary({ quote }) {
  return (
    <div className="price-summary">
      <div>
        <span>Item total</span>
        <b>{money(quote.subtotal_cents)}</b>
      </div>
      {quote.discount_cents > 0 && (
        <div className="discount-line">
          <span>Discount {quote.coupon_code}</span>
          <b>−{money(quote.discount_cents)}</b>
        </div>
      )}
      <div>
        <span>Delivery fee</span>
        <b className={!quote.delivery_cents ? "green" : ""}>
          {quote.delivery_cents ? money(quote.delivery_cents) : "FREE"}
        </b>
      </div>
      <div>
        <span>Packaging</span>
        <b>{money(quote.packaging_cents)}</b>
      </div>
      <div className="total">
        <strong>To pay</strong>
        <strong>{money(quote.total_cents)}</strong>
      </div>
    </div>
  );
}

function Modal({ data }) {
  const { setModal } = useApp();
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.close();
  }, []);
  const close = () => setModal(null);
  return (
    <dialog
      ref={ref}
      className={cx(
        "modal",
        data.type === "food" && "food-modal",
        data.type === "checkout" && "checkout-modal",
      )}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <button
        className="modal-close icon-btn"
        aria-label="Close dialog"
        onClick={close}
      >
        <Icon name="close" />
      </button>
      {data.type === "auth" ? (
        <Auth />
      ) : data.type === "food" ? (
        <FoodCustomization item={data.item} />
      ) : data.type === "cart" ? (
        <CartPanel full />
      ) : data.type === "coupons" ? (
        <Coupons />
      ) : data.type === "checkout" ? (
        <Checkout />
      ) : data.type === "address" ? (
        <AddressForm address={data.address} returnTo={data.returnTo} />
      ) : data.type === "review" ? (
        <ReviewForm order={data.order} onDone={data.onDone} />
      ) : data.type === "confirm" ? (
        <Confirm data={data} />
      ) : data.type === "menu-edit" ? (
        <MenuEditor item={data.item} onDone={data.onDone} />
      ) : null}
    </dialog>
  );
}
function Auth() {
  const { cfg, setUser, setModal, go, notify } = useApp();
  const [register, setRegister] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const a = useAction();
  function submit(e) {
    e.preventDefault();
    a.run(async () => {
      const r = await api(`/auth/${register ? "register" : "login"}`, {
        method: "POST",
        body: { name, email, password },
      });
      setUser(r.user);
      setModal(null);
      go(
        r.user.role === "admin"
          ? "admin"
          : r.user.role === "driver"
            ? "driver"
            : "home",
      );
      notify(
        `Welcome${register ? " to FoodLane," : " back,"} ${r.user.name.split(" ")[0]}!`,
      );
    });
  }
  return (
    <div className="modal-body auth">
      <Brand />
      <p className="eyebrow">GOOD FOOD IS JUST A SIGN-IN AWAY</p>
      <h2>{register ? "Join the good food club." : "Welcome back, foodie."}</h2>
      <p className="muted">
        {register
          ? "Create your account and discover your next favorite meal."
          : "Your favorites, your orders, your happy place."}
      </p>
      <form onSubmit={submit}>
        {register && (
          <Field
            label="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={80}
            autoComplete="name"
          />
        )}
        <Field
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={register ? 10 : 1}
          maxLength={128}
          autoComplete={register ? "new-password" : "current-password"}
          required
        />
        <ErrorText>{a.error}</ErrorText>
        <Button className="wide" disabled={a.busy}>
          {a.busy ? "One moment…" : register ? "Create account" : "Sign in"}
          <Icon name="arrow" size={17} />
        </Button>
      </form>
      <p className="auth-switch">
        {register ? "Already part of the club?" : "New around here?"}{" "}
        <button className="text-button" onClick={() => setRegister(!register)}>
          {register ? "Sign in" : "Create an account"}
        </button>
      </p>
      {cfg.demo && !register && (
        <div className="demo-accounts">
          <small>EXPLORE THE LOCAL DEMO</small>
          <div>
            {[
              ["Customer", "customer", "Customer123!"],
              ["Admin", "admin", "Admin123!"],
              ["Driver", "driver", "Driver123!"],
            ].map(([label, role, pw]) => (
              <button
                key={role}
                onClick={() => {
                  setEmail(`${role}@foodlane.local`);
                  setPassword(pw);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p>
            Choose an account to fill in its demo credentials, then sign in.
          </p>
        </div>
      )}
    </div>
  );
}
function FoodCustomization({ item }) {
  const { requireCustomer, setModal, setCart, notify } = useApp();
  const [size, setSize] = useState(item.options.sizes[0].id),
    [sauce, setSauce] = useState(item.options.sauces[0].id),
    [qty, setQty] = useState(1),
    [note, setNote] = useState("");
  const a = useAction();
  const price =
    item.price_cents +
    item.options.sizes.find((x) => x.id === size).add_cents +
    item.options.sauces.find((x) => x.id === sauce).add_cents;
  function add() {
    requireCustomer(() =>
      a.run(async () => {
        const r = await api("/cart", {
          method: "POST",
          body: { menu_id: item.id, quantity: qty, size, sauce, note },
        });
        setCart(r.items);
        setModal(null);
        notify(`${item.name} added to your cart.`);
      }),
    );
  }
  return (
    <>
      <img className="custom-image" src={item.image} alt={item.name} />
      <div className="modal-body">
        <p className="eyebrow">MAKE IT YOURS</p>
        <h2>{item.name}</h2>
        <p className="muted">{item.description}</p>
        <fieldset>
          <legend>
            Choose your size <small>Required</small>
          </legend>
          {item.options.sizes.map((x) => (
            <label key={x.id} className="option">
              <input
                type="radio"
                name="size"
                checked={size === x.id}
                onChange={() => setSize(x.id)}
              />
              <span>{x.label}</span>
              <b>{money(item.price_cents + x.add_cents)}</b>
            </label>
          ))}
        </fieldset>
        {item.options.sauces.length > 1 && (
          <fieldset>
            <legend>A little extra flavor</legend>
            {item.options.sauces.map((x) => (
              <label key={x.id} className="option">
                <input
                  type="radio"
                  name="sauce"
                  checked={sauce === x.id}
                  onChange={() => setSauce(x.id)}
                />
                <span>{x.label}</span>
                <b>{x.add_cents ? `+${money(x.add_cents)}` : "Free"}</b>
              </label>
            ))}
          </fieldset>
        )}
        <Field label="Any special requests? (optional)">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Less spicy, no onions…"
            maxLength={250}
          />
        </Field>
        <ErrorText>{a.error}</ErrorText>
        <div className="custom-bottom">
          <div className="qty large">
            <button
              aria-label="Decrease quantity"
              disabled={qty === 1}
              onClick={() => setQty(qty - 1)}
            >
              <Icon name="minus" size={16} />
            </button>
            <span>{qty}</span>
            <button
              aria-label="Increase quantity"
              disabled={qty === 20}
              onClick={() => setQty(qty + 1)}
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          <Button disabled={a.busy || !item.available} onClick={add}>
            {a.busy ? "Adding…" : `Add to cart · ${money(price * qty)}`}{" "}
            <Icon name="plus" size={16} />
          </Button>
        </div>
      </div>
    </>
  );
}
function Coupons() {
  const { setCoupon, setModal, cart, quote, coupon } = useApp();
  const [coupons, setCoupons] = useState([]),
    [code, setCode] = useState(coupon);
  const a = useAction();
  useEffect(() => {
    api("/coupons")
      .then((r) => setCoupons(r.coupons))
      .catch(() => {});
  }, []);
  function apply(value) {
    a.run(async () => {
      if (!cart.length)
        throw new Error("Add a meal to your cart before applying a discount.");
      await api("/cart/quote", { method: "POST", body: { coupon: value } });
      setCoupon(value.toUpperCase());
      setModal({ type: "cart" });
    });
  }
  return (
    <div className="modal-body">
      <p className="eyebrow">GOOD FOOD, BETTER DEAL</p>
      <h2>A little treat on us.</h2>
      <form
        className="coupon-entry"
        onSubmit={(e) => {
          e.preventDefault();
          apply(code);
        }}
      >
        <input
          aria-label="Coupon code"
          placeholder="Enter coupon code"
          value={code}
          maxLength={32}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <Button disabled={a.busy}>Apply</Button>
      </form>
      <ErrorText>{a.error}</ErrorText>
      <div className="coupon-list">
        {coupons.map((c) => (
          <div className="offer-card" key={c.code}>
            <span className="offer-icon">
              <Icon name="ticket" size={25} />
            </span>
            <div>
              <h3>{c.code}</h3>
              <p>{c.description}</p>
              <small>
                Min. {money(c.min_cents)} · Max. {money(c.cap_cents)}
              </small>
            </div>
            <button
              className="text-button"
              disabled={a.busy}
              onClick={() => apply(c.code)}
            >
              Apply
            </button>
          </div>
        ))}
      </div>
      {!cart.length && (
        <p className="note">Add your favorite meal to use an offer.</p>
      )}
    </div>
  );
}
function Checkout() {
  const {
    addresses,
    quote,
    quoteError,
    cart,
    coupon,
    cfg,
    setModal,
    setCart,
    setCoupon,
    go,
    notify,
  } = useApp();
  const [addressId, setAddressId] = useState(addresses[0]?.id || ""),
    [payment, setPayment] = useState("cod"),
    [instructions, setInstructions] = useState(""),
    [schedule, setSchedule] = useState("");
  const key = useRef(requestKey());
  const a = useAction();
  function submit(e) {
    e.preventDefault();
    a.run(async () => {
      const r = await api("/orders", {
        method: "POST",
        body: {
          address_id: addressId,
          payment_method: payment,
          coupon,
          instructions,
          scheduled_for: schedule ? new Date(schedule).toISOString() : null,
          idempotency_key: key.current,
        },
      });
      setCart([]);
      setCoupon("");
      setModal(null);
      go(`order/${r.order.id}`);
      notify("Order placed! Your next good bite is on its way.");
    });
  }
  return (
    <div className="modal-body">
      <p className="eyebrow">ONE LAST THING, THEN WE COOK</p>
      <h2>Let’s get it to your door.</h2>
      <form onSubmit={submit}>
        <div className="section-title">
          <h3>Delivery address</h3>
          <button
            type="button"
            className="text-button"
            onClick={() => setModal({ type: "address", returnTo: "checkout" })}
          >
            <Icon name="plus" size={15} /> Add new
          </button>
        </div>
        {addresses.length ? (
          addresses.map((x) => (
            <label
              className={cx("address-choice", x.id === addressId && "selected")}
              key={x.id}
            >
              <input
                type="radio"
                name="address"
                value={x.id}
                checked={addressId === x.id}
                onChange={() => setAddressId(x.id)}
                required
              />
              <Icon name="pin" />
              <span>
                <b>
                  {x.label} · {x.recipient}
                </b>
                <small>
                  {x.line1}, {x.city} {x.postcode}
                </small>
                <small>{x.phone}</small>
              </span>
            </label>
          ))
        ) : (
          <p className="note">Add a delivery address to continue.</p>
        )}
        <div className="form-grid">
          <Field label="Delivery time">
            <select
              value={schedule ? "scheduled" : "asap"}
              onChange={(e) =>
                setSchedule(
                  e.target.value === "scheduled"
                    ? new Date(
                        Date.now() +
                          3600000 -
                          new Date().getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : "",
                )
              }
            >
              <option value="asap">As soon as possible</option>
              <option value="scheduled">Schedule for later</option>
            </select>
          </Field>
          {schedule && (
            <Field
              label="Choose date and time"
              type="datetime-local"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              required
            />
          )}
        </div>
        <Field label="Delivery instructions (optional)">
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={400}
            placeholder="Building, landmark or any helpful details…"
          />
        </Field>
        <h3>How would you like to pay?</h3>
        <label className="payment-choice">
          <input
            type="radio"
            name="payment"
            checked={payment === "cod"}
            onChange={() => setPayment("cod")}
          />
          <Icon name="cash" />
          <span>
            <b>Cash on delivery</b>
            <small>Pay when your order arrives.</small>
          </span>
        </label>
        {cfg.demo && (
          <label className="payment-choice">
            <input
              type="radio"
              name="payment"
              checked={payment === "demo"}
              onChange={() => setPayment("demo")}
            />
            <Icon name="shield" />
            <span>
              <b>Demo payment</b>
              <small>Simulated success. No money is charged.</small>
            </span>
            <span className="tag">TEST</span>
          </label>
        )}
        <div className="checkout-items">
          <small>
            YOUR ORDER · {cart.reduce((s, x) => s + x.quantity, 0)} ITEMS
          </small>
          <div>
            {cart.map((x) => (
              <span key={x.id}>
                <img src={x.image} alt="" />
                {x.quantity} × {x.name}
              </span>
            ))}
          </div>
        </div>
        {quote && <PriceSummary quote={quote} />}
        <ErrorText>{a.error || quoteError}</ErrorText>
        <Button className="wide" disabled={a.busy || !addressId || !quote}>
          {a.busy
            ? "Placing your order…"
            : `Place order · ${money(quote?.total_cents)}`}
          <Icon name="arrow" size={17} />
        </Button>
        <p className="cart-caption">
          {cfg.demo
            ? "Local demo: orders do not reach a real restaurant."
            : "Please verify your delivery details before ordering."}
        </p>
      </form>
    </div>
  );
}
function AddressForm({ address, returnTo }) {
  const { user, setAddresses, setModal, notify } = useApp();
  const [data, setData] = useState(
    address || {
      label: "Home",
      recipient: user?.name || "",
      phone: user?.phone || "",
      line1: "",
      city: "Dehradun",
      postcode: "",
      instructions: "",
    },
  );
  const a = useAction();
  const fields = [
    ["label", "Address label", "Home / Work"],
    ["recipient", "Recipient name", "Full name"],
    ["phone", "Phone number", "Mobile number"],
    ["line1", "Street address", "House, street and landmark"],
    ["city", "City", "City"],
    ["postcode", "Postcode", "Postcode"],
  ];
  function submit(e) {
    e.preventDefault();
    a.run(async () => {
      await api(address ? `/addresses/${address.id}` : "/addresses", {
        method: address ? "PATCH" : "POST",
        body: data,
      });
      setAddresses((await api("/addresses")).addresses);
      setModal(returnTo ? { type: returnTo } : null);
      notify("Delivery address saved.");
    });
  }
  return (
    <div className="modal-body">
      <p className="eyebrow">YOUR FAVORITE DELIVERY SPOT</p>
      <h2>{address ? "Edit address" : "Add an address"}</h2>
      <form onSubmit={submit}>
        <div className="form-grid">
          {fields.map(([key, label, placeholder]) => (
            <Field
              key={key}
              label={label}
              value={data[key]}
              placeholder={placeholder}
              onChange={(e) => setData({ ...data, [key]: e.target.value })}
              required
              maxLength={key === "line1" ? 180 : 80}
            />
          ))}
        </div>
        <Field label="Delivery instructions">
          <textarea
            value={data.instructions}
            onChange={(e) => setData({ ...data, instructions: e.target.value })}
            maxLength={250}
          />
        </Field>
        <ErrorText>{a.error}</ErrorText>
        <Button className="wide" disabled={a.busy}>
          {a.busy ? "Saving…" : "Save address"}
          <Icon name="check" size={17} />
        </Button>
      </form>
    </div>
  );
}
function Confirm({ data }) {
  const { setModal } = useApp();
  const a = useAction();
  return (
    <div className="modal-body">
      <h2>{data.title}</h2>
      <p className="muted">{data.text}</p>
      <ErrorText>{a.error}</ErrorText>
      <div className="button-row">
        <Button variant="secondary" onClick={() => setModal(null)}>
          Go back
        </Button>
        <Button
          disabled={a.busy}
          onClick={() =>
            a.run(async () => {
              await data.onConfirm();
              setModal(null);
            })
          }
        >
          {a.busy ? "Please wait…" : "Confirm"}
        </Button>
      </div>
    </div>
  );
}

function LoginNeeded({ title = "Make yourself at home." }) {
  const { setModal } = useApp();
  return (
    <Empty
      icon="user"
      title={title}
      text="Sign in to see your saved details, favorites and orders."
      action={
        <Button onClick={() => setModal({ type: "auth" })}>
          Sign in <Icon name="arrow" size={16} />
        </Button>
      }
    />
  );
}
function Favorites() {
  const { user, favorites } = useApp();
  return (
    <section className="standard-page">
      <p className="eyebrow">LOVE AT FIRST BITE</p>
      <h1>
        Your favorites<span className="orange">.</span>
      </h1>
      <p className="page-intro">The meals you’ll come back for.</p>
      {!user ? (
        <LoginNeeded />
      ) : favorites.length ? (
        <div className="menu-grid favorites-grid">
          {favorites.map((x) => (
            <FoodCard item={x} key={x.id} />
          ))}
        </div>
      ) : (
        <Empty
          icon="heart"
          title="Start a delicious collection"
          text="Tap the heart on any meal to save it here."
        />
      )}
    </section>
  );
}
function Profile() {
  const {
    user,
    setUser,
    addresses,
    setAddresses,
    setModal,
    logout,
    notify,
    act,
  } = useApp();
  const [name, setName] = useState(user?.name || ""),
    [phone, setPhone] = useState(user?.phone || ""),
    [passwords, setPasswords] = useState({
      current_password: "",
      new_password: "",
    });
  const a = useAction(),
    p = useAction();
  useEffect(() => {
    setName(user?.name || "");
    setPhone(user?.phone || "");
  }, [user?.id]);
  if (!user) return <LoginNeeded />;
  return (
    <section className="standard-page">
      <p className="eyebrow">YOUR LITTLE CORNER</p>
      <h1>
        My profile<span className="orange">.</span>
      </h1>
      <div className="profile-grid">
        <div>
          <div className="panel">
            <div className="profile-heading">
              <span className="avatar big">{user.name[0]}</span>
              <div>
                <h2>{user.name}</h2>
                <p>{user.email}</p>
                <span className="tag">{user.role}</span>
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                a.run(async () => {
                  const r = await api("/profile", {
                    method: "PATCH",
                    body: { name, phone },
                  });
                  setUser(r.user);
                  notify("Profile updated.");
                });
              }}
            >
              <Field
                label="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={80}
              />
              <Field
                label="Phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={20}
              />
              <ErrorText>{a.error}</ErrorText>
              <Button disabled={a.busy}>Save changes</Button>
            </form>
          </div>
          <div className="panel">
            <h3>Change password</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                p.run(async () => {
                  await api("/profile/password", {
                    method: "POST",
                    body: passwords,
                  });
                  setPasswords({ current_password: "", new_password: "" });
                  notify(
                    "Password updated. Other sessions have been signed out.",
                  );
                });
              }}
            >
              <Field
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={passwords.current_password}
                onChange={(e) =>
                  setPasswords({
                    ...passwords,
                    current_password: e.target.value,
                  })
                }
                required
              />
              <Field
                label="New password · at least 10 characters"
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                value={passwords.new_password}
                onChange={(e) =>
                  setPasswords({ ...passwords, new_password: e.target.value })
                }
                required
              />
              <ErrorText>{p.error}</ErrorText>
              <Button variant="secondary" disabled={p.busy}>
                Update password
              </Button>
            </form>
          </div>
        </div>
        <div>
          {user.role === "customer" && (
            <div className="panel">
              <div className="section-title">
                <h2>Saved addresses</h2>
                <button
                  className="text-button"
                  onClick={() => setModal({ type: "address" })}
                >
                  <Icon name="plus" size={16} /> Add
                </button>
              </div>
              {addresses.map((x) => (
                <div className="saved-address" key={x.id}>
                  <Icon name="pin" />
                  <div>
                    <b>{x.label}</b>
                    <p>
                      {x.recipient}
                      <br />
                      {x.line1}
                      <br />
                      {x.city} {x.postcode}
                      <br />
                      {x.phone}
                    </p>
                    <div className="button-row">
                      <button
                        className="text-button small"
                        onClick={() =>
                          setModal({ type: "address", address: x })
                        }
                      >
                        Edit
                      </button>
                      <button
                        className="text-button small danger-text"
                        onClick={() =>
                          setModal({
                            type: "confirm",
                            title: "Delete this address?",
                            text: "Past orders will keep their original delivery address.",
                            onConfirm: async () => {
                              await api(`/addresses/${x.id}`, {
                                method: "DELETE",
                                body: {},
                              });
                              setAddresses(
                                addresses.filter((a) => a.id !== x.id),
                              );
                            },
                          })
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {!addresses.length && (
                <p className="muted">Save an address for a faster checkout.</p>
              )}
            </div>
          )}
          <div className="panel">
            <h3>See you at the next meal.</h3>
            <p className="muted">You can safely sign out of this device.</p>
            <Button variant="secondary" onClick={logout}>
              <Icon name="logout" size={17} /> Sign out
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Orders() {
  const { user, go } = useApp();
  const [orders, setOrders] = useState(null),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all");
  useEffect(() => {
    if (!user) return;
    let live = true;
    const load = () =>
      api("/orders")
        .then((r) => {
          if (live) {
            setOrders(r.orders);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    load();
    const timer = setInterval(load, 8000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [user?.id]);
  if (!user) return <LoginNeeded title="Your good food memories." />;
  const visible = orders?.filter(
    (x) =>
      filter === "all" ||
      (filter === "active"
        ? !["delivered", "cancelled"].includes(x.status)
        : ["delivered", "cancelled"].includes(x.status)),
  );
  return (
    <section className="standard-page">
      <p className="eyebrow">FROM THE FIRST BITE TO THE LAST</p>
      <h1>
        {user.role === "customer" ? "My orders" : "Order history"}
        <span className="orange">.</span>
      </h1>
      <div className="tabs">
        {["all", "active", "past"].map((x) => (
          <button
            key={x}
            className={filter === x ? "active" : ""}
            onClick={() => setFilter(x)}
          >
            {x === "all"
              ? "All orders"
              : x === "active"
                ? "In progress"
                : "Past orders"}
          </button>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
      {!orders ? (
        <Loading />
      ) : !visible.length ? (
        <Empty
          icon="receipt"
          title="Your next meal is waiting"
          text="Orders will appear here once they are placed."
          action={
            <Button onClick={() => go("home")}>
              Explore the menu <Icon name="arrow" size={16} />
            </Button>
          }
        />
      ) : (
        <div className="order-list">
          {visible.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </section>
  );
}
function OrderCard({ order }) {
  const { go } = useApp();
  return (
    <button className="order-card" onClick={() => go(`order/${order.id}`)}>
      <img src={order.restaurant_image} alt="" />
      <div className="order-card-main">
        <div className="order-card-title">
          <h3>{order.restaurant_name}</h3>
          <Status status={order.status} />
        </div>
        <p>{order.items.map((x) => `${x.quantity} × ${x.name}`).join(" · ")}</p>
        <small>
          {order.number} · {time(order.created_at)}
        </small>
        {order.customer_name && <small>{order.customer_name}</small>}
      </div>
      <div className="order-card-end">
        <b>{money(order.total_cents)}</b>
        <span>
          View order <Icon name="chevron" size={16} />
        </span>
      </div>
    </button>
  );
}
function TrackingMap({ status }) {
  const index = Math.max(0, steps.indexOf(status)),
    pos = index < 4 ? [130, 158] : index === 4 ? [270, 100] : [367, 70];
  return (
    <div className="tracking-map">
      <svg
        viewBox="0 0 500 235"
        role="img"
        aria-label="Illustrative delivery route"
      >
        <rect width="500" height="235" fill="#f2f0e9" />
        {[
          [20, 20, 90, 60],
          [140, 10, 100, 60],
          [305, 5, 160, 40],
          [20, 120, 70, 70],
          [175, 125, 85, 90],
          [330, 150, 150, 60],
        ].map(([x, y, w, h], i) => (
          <rect
            key={i}
            x={x}
            y={y}
            width={w}
            height={h}
            rx="10"
            fill={i % 3 === 0 ? "#dde6cf" : "#e6e2d8"}
          />
        ))}
        <path
          d="M0 100 170 85 310 120 500 90M110 0l30 100-45 135M290 0l-10 120 35 115M390 0l-20 235"
          stroke="white"
          strokeWidth="22"
          fill="none"
        />
        <path
          d="m130 158 10-60 140 22 87-50"
          stroke="#ff6813"
          strokeWidth="5"
          strokeDasharray="8 7"
          fill="none"
        />
        <circle cx="130" cy="158" r="11" fill="#262522" />
        <circle cx="367" cy="70" r="11" fill="#ff6813" />
        <circle
          cx={pos[0]}
          cy={pos[1]}
          r="17"
          fill="#fff"
          stroke="#ff6813"
          strokeWidth="4"
        />
        <text x="105" y="190" fill="#74746d" fontSize="12">
          Kitchen
        </text>
        <text x="380" y="68" fill="#74746d" fontSize="12">
          Your door
        </text>
      </svg>
      <span>Illustrative route · no live GPS</span>
    </div>
  );
}
function OrderDetail({ orderId }) {
  const {
    user,
    cfg,
    go,
    act,
    setModal,
    setCart,
    setCoupon,
    notify,
    loadCatalog,
  } = useApp();
  const [order, setOrder] = useState(null),
    [error, setError] = useState(""),
    [drivers, setDrivers] = useState([]);
  const a = useAction();
  async function load() {
    const r = await api(`/orders/${orderId}`);
    setOrder(r.order);
  }
  useEffect(() => {
    if (!user) return;
    let live = true;
    const refresh = () =>
      api(`/orders/${orderId}`)
        .then((r) => {
          if (live) {
            setOrder(r.order);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    refresh();
    if (user.role === "admin")
      api("/admin/drivers")
        .then((r) => setDrivers(r.drivers))
        .catch(() => {});
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [orderId, user?.id]);
  if (!user) return <LoginNeeded />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!order) return <Loading />;
  const current = steps.indexOf(order.status),
    finished = ["cancelled", "delivered"].includes(order.status);
  const update = (path, body = {}, method = "POST") =>
    a.run(async () => {
      const r = await api(path, { method, body });
      setOrder(r.order);
    });
  function reorder() {
    setModal({
      type: "confirm",
      title: "Enjoy it all over again?",
      text: "This replaces your cart with the same meal, using current prices and availability.",
      onConfirm: async () => {
        const r = await api(`/orders/${orderId}/reorder`, {
          method: "POST",
          body: { replace: true },
        });
        setCart(r.items);
        setCoupon("");
        go("home");
        notify("Your favorites are back in the cart.");
      },
    });
  }
  return (
    <section className="standard-page order-detail">
      <button className="text-button back-button" onClick={() => go("orders")}>
        <Icon name="back" size={17} /> Back to orders
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{order.number}</p>
          <h1>
            {order.status === "delivered"
              ? "That was a good bite."
              : order.status === "cancelled"
                ? "Order cancelled."
                : "Your meal is on its journey."}
          </h1>
        </div>
        <Status status={order.status} />
      </div>
      <div className="order-detail-grid">
        <div>
          <div className="panel tracking-panel">
            <TrackingMap status={order.status} />
            <div className="tracking-heading">
              <div>
                <h2>{order.restaurant_name}</h2>
                <p>
                  {order.scheduled_for
                    ? `Scheduled for ${time(order.scheduled_for)}`
                    : finished
                      ? `Updated ${time(order.updated_at)}`
                      : `Estimated delivery: ${order.eta} minutes`}
                </p>
              </div>
              <Icon name="bike" size={32} />
            </div>
            {order.status !== "cancelled" && (
              <ol className="timeline">
                {steps.map((s, i) => (
                  <li key={s} className={i <= current ? "complete" : ""}>
                    <span>
                      {i <= current ? <Icon name="check" size={13} /> : i + 1}
                    </span>
                    <div>
                      <b>{labels[s]}</b>
                      <small>
                        {order.events.find((x) => x.status === s)
                          ? time(
                              order.events.find((x) => x.status === s)
                                .created_at,
                            )
                          : "Coming up"}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {cfg.demo && user.role === "customer" && !finished && (
              <div className="demo-progress">
                <div>
                  <b>Try the whole delivery journey</b>
                  <p>
                    Demo controls advance this order. No real delivery is
                    scheduled.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={a.busy}
                  onClick={() => update(`/orders/${orderId}/demo-advance`)}
                >
                  Demo: {labels[steps[current + 1]]}
                  <Icon name="arrow" size={15} />
                </Button>
              </div>
            )}
            {user.role === "admin" && !finished && (
              <div className="staff-actions">
                <Field label="Assigned delivery partner">
                  <select
                    value={order.driver_id || ""}
                    onChange={(e) =>
                      update(
                        `/admin/orders/${orderId}/driver`,
                        { driver_id: e.target.value },
                        "PATCH",
                      )
                    }
                    disabled={a.busy}
                  >
                    <option value="">Choose driver</option>
                    {drivers.map((d) => (
                      <option value={d.id} key={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  disabled={a.busy}
                  onClick={() =>
                    update(
                      `/orders/${orderId}/status`,
                      { status: steps[current + 1] },
                      "PATCH",
                    )
                  }
                >
                  Mark {labels[steps[current + 1]]}
                </Button>
              </div>
            )}
            {user.role === "driver" &&
              ["ready", "out_for_delivery"].includes(order.status) && (
                <Button
                  disabled={a.busy}
                  onClick={() =>
                    update(
                      `/orders/${orderId}/status`,
                      { status: steps[current + 1] },
                      "PATCH",
                    )
                  }
                >
                  {order.status === "ready"
                    ? "Confirm pickup"
                    : "Mark delivered"}
                </Button>
              )}
            <ErrorText>{a.error}</ErrorText>
          </div>
          <div className="panel">
            <h3>Delivery details</h3>
            <div className="info-row">
              <Icon name="pin" />
              <div>
                <b>
                  {order.address.recipient} · {order.address.label}
                </b>
                <p>
                  {order.address.line1}, {order.address.city}{" "}
                  {order.address.postcode}
                </p>
                <p>{order.address.phone}</p>
                {order.address.instructions && (
                  <p>{order.address.instructions}</p>
                )}
              </div>
            </div>
            {order.instructions && <p className="note">{order.instructions}</p>}
            <div className="driver-card">
              <span className="avatar">
                <Icon name="bike" />
              </span>
              <div>
                <b>{order.driver_name || "Delivery partner"}</b>
                <p>
                  {order.driver_name
                    ? "Assigned to your order"
                    : "Will be assigned by the kitchen"}
                </p>
              </div>
              <Icon name="chat" />
            </div>
          </div>
          <Chat orderId={orderId} />
        </div>
        <aside>
          <div className="panel">
            <div className="section-title">
              <h2>Order summary</h2>
              <Icon name="receipt" />
            </div>
            {order.items.map((x) => (
              <div className="summary-item" key={x.id}>
                <img src={x.image} alt="" />
                <div>
                  <b>{x.name}</b>
                  <small>
                    {x.quantity} × {money(x.unit_cents)} · {x.size}
                  </small>
                  {x.sauce !== "none" && <small>{x.sauce} sauce</small>}
                  {x.note && <small>{x.note}</small>}
                </div>
                <strong>{money(x.quantity * x.unit_cents)}</strong>
              </div>
            ))}
            <PriceSummary quote={order} />
            <div className="payment-info">
              <Icon name="cash" size={18} />
              <div>
                <b>
                  {order.payment_method === "demo"
                    ? "Demo payment"
                    : "Cash on delivery"}
                </b>
                <small>{order.payment_status.replaceAll("_", " ")}</small>
              </div>
            </div>
            <div className="order-buttons">
              {user.role === "customer" && finished && (
                <Button className="wide" onClick={reorder}>
                  Order again <Icon name="bag" size={16} />
                </Button>
              )}
              {user.role === "customer" &&
                order.status === "delivered" &&
                !order.review && (
                  <Button
                    variant="secondary"
                    className="wide"
                    onClick={() =>
                      setModal({
                        type: "review",
                        order,
                        onDone: () => {
                          load();
                          loadCatalog();
                        },
                      })
                    }
                  >
                    How was your meal? <Icon name="star" size={16} />
                  </Button>
                )}
              {order.review && (
                <p className="review-thanks">
                  <Icon name="star" size={17} /> You rated this meal{" "}
                  {order.review.rating}/5. Thank you!
                </p>
              )}
              {!finished &&
                (user.role === "admin" ||
                  (user.role === "customer" &&
                    ["placed", "accepted"].includes(order.status))) && (
                  <button
                    className="text-button danger-text"
                    onClick={() =>
                      setModal({
                        type: "confirm",
                        title: "Cancel this order?",
                        text:
                          order.payment_method === "demo"
                            ? "This is a simulated payment. It will be marked demo refunded."
                            : "The kitchen will be notified in this app. No cash payment is due.",
                        onConfirm: async () => {
                          const r = await api(`/orders/${orderId}/cancel`, {
                            method: "POST",
                            body: {},
                          });
                          setOrder(r.order);
                        },
                      })
                    }
                  >
                    Cancel order
                  </button>
                )}
              <button
                className="text-button small print-button"
                onClick={() => window.print()}
              >
                Print order receipt
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
function Chat({ orderId }) {
  const { user } = useApp();
  const [messages, setMessages] = useState([]),
    [body, setBody] = useState(""),
    [error, setError] = useState("");
  const a = useAction(),
    bottom = useRef();
  const load = () =>
    api(`/orders/${orderId}/messages`).then((r) => {
      setMessages(r.messages);
      setError("");
    });
  useEffect(() => {
    let live = true;
    const fetchMessages = () =>
      api(`/orders/${orderId}/messages`)
        .then((r) => {
          if (live) {
            setMessages(r.messages);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    fetchMessages();
    const timer = setInterval(fetchMessages, 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [orderId]);
  useEffect(() => {
    const box = bottom.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages.length]);
  return (
    <section className="panel chat-panel">
      <div className="section-title">
        <div>
          <h3>Order chat</h3>
          <p className="muted small">
            Messages are shared with the kitchen and assigned driver.
          </p>
        </div>
        <Icon name="chat" />
      </div>
      <div className="chat-messages">
        {!messages.length && (
          <p className="chat-empty">
            Questions about your order? Start a conversation.
            <br />
            <small>A staff member must sign in to reply.</small>
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cx("message", m.sender_id === user.id && "own")}
          >
            <small>
              {m.sender_id === user.id ? "You" : `${m.name} · ${m.role}`}
            </small>
            <p>{m.body}</p>
            <time>
              {new Date(m.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          a.run(async () => {
            await api(`/orders/${orderId}/messages`, {
              method: "POST",
              body: { body },
            });
            setBody("");
            await load();
          });
        }}
      >
        <input
          aria-label="Message"
          placeholder="Write a message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
          required
        />
        <button
          className="send-button"
          aria-label="Send message"
          disabled={a.busy || !body.trim()}
        >
          <Icon name="send" size={18} />
        </button>
      </form>
      <ErrorText>{a.error || error}</ErrorText>
    </section>
  );
}
function ReviewForm({ order, onDone }) {
  const { setModal, notify } = useApp();
  const [rating, setRating] = useState(0),
    [driver, setDriver] = useState(0),
    [body, setBody] = useState("");
  const a = useAction();
  const stars = (v, set, label) => (
    <div className="rating-buttons" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          className={n <= v ? "chosen" : ""}
          aria-label={`${label} ${n} stars`}
          aria-pressed={v === n}
          onClick={() => set(n)}
        >
          <Icon name="star" size={31} />
        </button>
      ))}
    </div>
  );
  return (
    <div className="modal-body review-form">
      <span className="empty-icon">
        <Icon name="star" size={34} />
      </span>
      <h2>Good food deserves good words.</h2>
      <p className="muted">
        How was your experience at {order.restaurant_name}?
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          a.run(async () => {
            if (!rating) throw new Error("Please choose a restaurant rating.");
            await api(`/orders/${order.id}/review`, {
              method: "POST",
              body: { rating, driver_rating: driver || null, body },
            });
            onDone?.();
            setModal(null);
            notify("Thank you for sharing your experience.");
          });
        }}
      >
        {stars(rating, setRating, "Restaurant rating")}
        {order.driver_id && (
          <>
            <p className="muted">
              How was your delivery with {order.driver_name}?
            </p>
            {stars(driver, setDriver, "Driver rating")}
          </>
        )}
        <Field label="Your review (optional)">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={1000}
            placeholder="What made your meal memorable?"
          />
        </Field>
        <ErrorText>{a.error}</ErrorText>
        <Button className="wide" disabled={a.busy}>
          Share your review <Icon name="arrow" size={16} />
        </Button>
      </form>
    </div>
  );
}

function Admin() {
  const { user, menu, restaurants, loadCatalog, setModal, act, notify } =
    useApp();
  const [tab, setTab] = useState("Orders"),
    [stats, setStats] = useState(null),
    [orders, setOrders] = useState([]),
    [coupons, setCoupons] = useState([]),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("active");
  const load = async () => {
    const [s, o, c] = await Promise.all([
      api("/admin/stats"),
      api("/orders"),
      api("/admin/coupons"),
    ]);
    setStats(s.stats);
    setOrders(o.orders);
    setCoupons(c.coupons);
  };
  useEffect(() => {
    if (user?.role !== "admin") return;
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [user?.id]);
  if (!user) return <LoginNeeded />;
  if (user.role !== "admin")
    return (
      <Empty
        icon="shield"
        title="Kitchen team only"
        text="Sign in with an administrator account to manage the kitchen."
      />
    );
  return (
    <section className="standard-page">
      <p className="eyebrow">BEHIND EVERY GOOD BITE</p>
      <div className="page-heading">
        <h1>
          The kitchen desk<span className="orange">.</span>
        </h1>
        <span className="tag">ADMIN WORKSPACE</span>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="stat-grid">
        {[
          ["receipt", "Total orders", stats?.total_orders ?? 0],
          ["clock", "In progress", stats?.active_orders ?? 0],
          ["cash", "Delivered sales", money(stats?.revenue_cents)],
          ["user", "Customers", stats?.customers ?? 0],
        ].map(([icon, label, value]) => (
          <div className="stat-card" key={label}>
            <span>
              <Icon name={icon} />
            </span>
            <div>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          </div>
        ))}
      </div>
      <div className="tabs">
        {["Orders", "Menu", "Offers"].map((x) => (
          <button
            key={x}
            className={tab === x ? "active" : ""}
            onClick={() => setTab(x)}
          >
            {x}
          </button>
        ))}
      </div>
      {tab === "Orders" ? (
        <>
          <div className="section-title">
            <h2>Order queue</h2>
            <select
              aria-label="Order filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="active">Active orders</option>
              <option value="all">All orders</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="order-list">
            {orders
              .filter(
                (o) =>
                  filter === "all" ||
                  (filter === "active" &&
                    !["delivered", "cancelled"].includes(o.status)) ||
                  o.status === filter,
              )
              .map((o) => (
                <OrderCard order={o} key={o.id} />
              ))}
          </div>
          {!orders.length && (
            <Empty
              icon="receipt"
              title="Ready for the first order"
              text="Orders placed by customers appear here. Open an order to confirm, prepare, assign and dispatch."
            />
          )}
        </>
      ) : tab === "Menu" ? (
        <>
          <div className="section-title">
            <h2>Menu & availability</h2>
            <Button
              onClick={() =>
                setModal({ type: "menu-edit", onDone: loadCatalog })
              }
            >
              <Icon name="plus" size={16} /> Add item
            </Button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Menu item</th>
                  <th>Kitchen</th>
                  <th>Price</th>
                  <th>Availability</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {menu.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="table-item">
                        <img src={item.image} alt="" />
                        <b>{item.name}</b>
                      </span>
                    </td>
                    <td>{item.restaurant_name}</td>
                    <td>{money(item.price_cents)}</td>
                    <td>
                      <button
                        className={cx("availability", item.available && "on")}
                        onClick={() =>
                          act(async () => {
                            await api(`/admin/menu/${item.id}`, {
                              method: "PATCH",
                              body: { available: !item.available },
                            });
                            await loadCatalog();
                          })
                        }
                      >
                        {item.available ? "Available" : "Unavailable"}
                      </button>
                    </td>
                    <td>
                      <button
                        className="icon-btn"
                        aria-label={`Edit ${item.name}`}
                        onClick={() =>
                          setModal({
                            type: "menu-edit",
                            item,
                            onDone: loadCatalog,
                          })
                        }
                      >
                        <Icon name="edit" size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="offers-admin">
          <div className="panel">
            <h2>Current offers</h2>
            {coupons.map((c) => (
              <div className="admin-coupon" key={c.code}>
                <div>
                  <b>{c.code}</b>
                  <p>{c.description}</p>
                  <small>Expires {time(c.expires_at)}</small>
                </div>
                <button
                  className={cx("availability", !!c.active && "on")}
                  onClick={() =>
                    act(async () => {
                      await api(`/admin/coupons/${c.code}`, {
                        method: "PATCH",
                        body: { active: !c.active },
                      });
                      await load();
                    })
                  }
                >
                  {c.active ? "Active" : "Disabled"}
                </button>
              </div>
            ))}
          </div>
          <CouponEditor onDone={load} />
        </div>
      )}
    </section>
  );
}
function MenuEditor({ item, onDone }) {
  const { restaurants, setModal, notify } = useApp();
  const [data, setData] = useState({
    restaurant_id: item?.restaurant_id || restaurants[0]?.id,
    name: item?.name || "",
    description: item?.description || "",
    category: item?.category || "Burgers",
    price: item ? item.price_cents / 100 : "",
    image: "burger",
    vegetarian: item?.vegetarian || false,
  });
  const a = useAction();
  function submit(e) {
    e.preventDefault();
    a.run(async () => {
      await api(item ? `/admin/menu/${item.id}` : "/admin/menu", {
        method: item ? "PATCH" : "POST",
        body: { ...data, price_cents: Math.round(Number(data.price) * 100) },
      });
      await onDone?.();
      setModal(null);
      notify("Menu saved.");
    });
  }
  return (
    <div className="modal-body">
      <h2>{item ? "Edit menu item" : "Add something delicious"}</h2>
      <form onSubmit={submit}>
        {!item && (
          <Field label="Restaurant">
            <select
              value={data.restaurant_id}
              onChange={(e) =>
                setData({ ...data, restaurant_id: e.target.value })
              }
            >
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field
          label="Name"
          value={data.name}
          maxLength={100}
          onChange={(e) => setData({ ...data, name: e.target.value })}
          required
        />
        <Field label="Description">
          <textarea
            value={data.description}
            maxLength={600}
            onChange={(e) => setData({ ...data, description: e.target.value })}
            required
          />
        </Field>
        <Field
          label="Price (₹)"
          type="number"
          min="0.01"
          max="10000"
          step="0.01"
          value={data.price}
          onChange={(e) => setData({ ...data, price: e.target.value })}
          required
        />
        {!item && (
          <>
            <Field
              label="Category"
              value={data.category}
              maxLength={40}
              onChange={(e) => setData({ ...data, category: e.target.value })}
              required
            />
            <Field label="Food image">
              <select
                value={data.image}
                onChange={(e) => setData({ ...data, image: e.target.value })}
              >
                {[
                  "burger",
                  "pizza",
                  "salad",
                  "wings",
                  "pasta",
                  "fries",
                  "dessert",
                  "coffee",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <label className="option">
              <input
                type="checkbox"
                checked={data.vegetarian}
                onChange={(e) =>
                  setData({ ...data, vegetarian: e.target.checked })
                }
              />{" "}
              Vegetarian
            </label>
          </>
        )}
        <ErrorText>{a.error}</ErrorText>
        <Button className="wide" disabled={a.busy}>
          Save menu item
        </Button>
      </form>
    </div>
  );
}
function CouponEditor({ onDone }) {
  const { notify } = useApp();
  const [data, setData] = useState({
    code: "",
    description: "",
    type: "percent",
    value: 10,
    min: 200,
    cap: 100,
    expires: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    first_only: false,
  });
  const a = useAction();
  const update = (key, value) => setData({ ...data, [key]: value });
  return (
    <div className="panel">
      <h2>Create an offer</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          a.run(async () => {
            await api("/admin/coupons", {
              method: "POST",
              body: {
                code: data.code,
                description: data.description,
                type: data.type,
                value:
                  data.type === "fixed"
                    ? Math.round(Number(data.value) * 100)
                    : Number(data.value),
                min_cents: Math.round(Number(data.min) * 100),
                cap_cents: Math.round(Number(data.cap) * 100),
                expires_at: new Date(data.expires + "T23:59:59").toISOString(),
                first_only: data.first_only,
              },
            });
            await onDone();
            notify("Coupon created.");
            setData({ ...data, code: "", description: "" });
          });
        }}
      >
        <Field
          label="Code"
          value={data.code}
          onChange={(e) => update("code", e.target.value.toUpperCase())}
          required
          maxLength={32}
        />
        <Field
          label="Description"
          value={data.description}
          onChange={(e) => update("description", e.target.value)}
          required
          maxLength={200}
        />
        <div className="form-grid">
          <Field label="Discount type">
            <select
              value={data.type}
              onChange={(e) => update("type", e.target.value)}
            >
              <option value="percent">Percentage (%)</option>
              <option value="fixed">Fixed amount (₹)</option>
            </select>
          </Field>
          <Field
            label={data.type === "percent" ? "Percentage" : "Amount (₹)"}
            type="number"
            min="1"
            max={data.type === "percent" ? 100 : 1000}
            value={data.value}
            onChange={(e) => update("value", e.target.value)}
            required
          />
          <Field
            label="Minimum order (₹)"
            type="number"
            min="0"
            value={data.min}
            onChange={(e) => update("min", e.target.value)}
            required
          />
          <Field
            label="Maximum discount (₹)"
            type="number"
            min="1"
            value={data.cap}
            onChange={(e) => update("cap", e.target.value)}
            required
          />
        </div>
        <Field
          label="Expires on"
          type="date"
          value={data.expires}
          onChange={(e) => update("expires", e.target.value)}
          required
        />
        <label className="option">
          <input
            type="checkbox"
            checked={data.first_only}
            onChange={(e) => update("first_only", e.target.checked)}
          />{" "}
          First orders only
        </label>
        <ErrorText>{a.error}</ErrorText>
        <Button disabled={a.busy}>Create offer</Button>
      </form>
    </div>
  );
}
function Driver() {
  const { user, go } = useApp();
  const [orders, setOrders] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (user?.role !== "driver") return;
    let live = true;
    const load = () =>
      api("/orders")
        .then((r) => {
          if (live) setOrders(r.orders);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    load();
    const timer = setInterval(load, 6000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [user?.id]);
  if (!user) return <LoginNeeded />;
  if (user.role !== "driver")
    return (
      <Empty
        icon="bike"
        title="Delivery partner workspace"
        text="Sign in with a driver account to manage assigned deliveries."
      />
    );
  const active = orders?.filter(
    (o) => !["delivered", "cancelled"].includes(o.status),
  );
  return (
    <section className="standard-page">
      <p className="eyebrow">BRING A LITTLE HAPPINESS TO THE DOOR</p>
      <h1>
        Let’s make someone’s day<span className="orange">.</span>
      </h1>
      <p className="page-intro">
        Your assigned deliveries. Open an order for pickup details, customer
        chat and delivery confirmation.
      </p>
      <ErrorText>{error}</ErrorText>
      <div className="section-title">
        <h2>Today’s delivery queue</h2>
        <span className="tag">{active?.length || 0} ACTIVE</span>
      </div>
      {!orders ? (
        <Loading />
      ) : active.length ? (
        <div className="order-list">
          {active.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      ) : (
        <Empty
          icon="bike"
          title="You’re all caught up"
          text="The kitchen will assign your next delivery. This screen updates automatically."
        />
      )}
      <button className="text-button" onClick={() => go("orders")}>
        View delivery history <Icon name="arrow" size={16} />
      </button>
    </section>
  );
}
