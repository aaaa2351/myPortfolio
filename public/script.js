const DATA_URL = "data/portfolio.json";
const PREVIEW_CHANNEL = "portfolio-cms";
const FOCUS_TARGETS = ["home", "projects", "about", "services", "contact"];

const mainNav = document.querySelector(".main_nav");
const menuBtn = document.querySelector(".menu_btn");
const talkBtn = document.querySelector(".talk_btn");
const navLinks = document.querySelectorAll(".links a");

const ARROW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>';

const FALLBACK_CONTENT = {
  site: {
    pageTitle: "Portfolio",
    metaDescription:
      "Portfolio of a developer building modern, functional and user focused web applications.",
    navName: "Okikiola Toloruntomi",
    navButton: { label: "Let's Talk", target: "#contact" },
  },
  hero: {
    heading: "Building digital experiences that matter",
    highlight: "matter",
    description:
      "I am a developer who builds modern, functional, and user focused web applications.",
    image: "images/pexels-dkomov-34803979.jpg",
    imageAlt: "Workspace",
    available: true,
    statusText: "Available for new projects",
    primaryButton: { label: "Explore My Work", target: "#projects" },
    secondaryButton: { label: "Get In Touch", target: "#contact" },
  },
  profile: {
    name: "Okikiola Toloruntomi",
    image: "images/avatar.jpg",
    imageAlt: "Avatar",
    aboutHeading: "I am",
    aboutDescription:
      "I'm a passionate developer who loves solving real-world problems through clean, efficient and scalable code. I specialize in modern web technologies and enjoy building products that are fast, accessible and easy to use.",
  },
  contact: {
    tag: "Contact Me",
    heading: "Let's build something amazing together.",
    highlight: "together.",
    text: "Have a project in mind, a question, or just want to say hello?\nI'd love to hear from you.",
    email: "okikiolatoloruntomi1234@gmail.com",
    buttonLabel: "Email Me",
    bannerImage: "images/pexels-dkomov-34803979.jpg",
  },
  socials: [
    { id: "social-linkedin", platform: "linkedin", url: "" },
    { id: "social-github", platform: "github", url: "" },
    { id: "social-instagram", platform: "instagram", url: "" },
  ],
  footer: {
    brandName: "Okikiola.",
    roles: ["Developer", "Problem Solver", "Creator"],
    copyright: "\u00a9 2026 Okikiola . All rights reserved.",
  },
  projectList: [
    {
      id: "project-cipher",
      name: "Cipher",
      imageSrc: "images/cipher.png",
      description: "A premium platform built for learning and growth",
      appType: "Web App",
      liveUrl: "https://cipherquiz.vercel.app",
      githubUrl: "",
    },
    {
      id: "project-the-fish-spot",
      name: "The fish spot",
      imageSrc: "images/fishSpot.jpg",
      description: "A modern restaurant website for The Fish Spot.",
      appType: "Website",
      liveUrl: "https://cipherquiz.vercel.app",
      githubUrl: "",
    },
    {
      id: "project-task-manager",
      name: "Task Manager",
      imageSrc:
        "https://images.unsplash.com/photo-1540350394557-8d14678e7f91?auto=format&fit=crop&w=600&q=80",
      description:
        "A productivity tool designed to track and organize daily workflows.",
      appType: "Web App",
      liveUrl: "https://cipherquiz.vercel.app",
      githubUrl: "",
    },
  ],
  tools: [
    { id: "tool-html5", name: "HTML5", logo: "images/html.jpg" },
    { id: "tool-css3", name: "CSS3", logo: "images/css.jpg" },
    { id: "tool-git", name: "Git", logo: "images/git.svg" },
    { id: "tool-javascript", name: "JavaScript", logo: "images/js.jpg" },
    { id: "tool-blender", name: "Blender", logo: "images/blender.jpg" },
  ],
  wds: [
    {
      id: "service-web-development",
      logo: "images/wds/web.svg",
      title: "Web Development",
      description: "Modern, responsive and scalable web applications.",
    },
    {
      id: "service-interactive-javascript",
      logo: "images/wds/js.svg",
      title: "Interactive JavaScript",
      description:
        "Adding dynamic behavior, custom logic, and interactive features to websites using vanilla JavaScript.",
    },
    {
      id: "service-3d-modeling",
      logo: "images/wds/3d.svg",
      title: "3D Modeling & Assets",
      description:
        "Crafting custom 3D models, low-poly assets, and visual elements for digital projects using Blender.",
    },
    {
      id: "service-ui-ux",
      logo: "images/wds/design.svg",
      title: "UI/UX Development",
      description: "Beautiful, intuitive and user-centered designs.",
    },
  ],
};

const SOCIAL_ICONS = {
  linkedin: "fa-brands fa-linkedin-in",
  github: "fa-brands fa-github",
  instagram: "fa-brands fa-instagram",
  x: "fa-brands fa-x-twitter",
  youtube: "fa-brands fa-youtube",
  facebook: "fa-brands fa-facebook-f",
  dribbble: "fa-brands fa-dribbble",
  behance: "fa-brands fa-behance",
};

const SOCIAL_LABELS = {
  linkedin: "LinkedIn",
  github: "GitHub",
  instagram: "Instagram",
  x: "X",
  youtube: "YouTube",
  facebook: "Facebook",
  dribbble: "Dribbble",
  behance: "Behance",
};

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const text = (value, fallback = "") =>
  typeof value === "string" ? value : fallback;

function safeHttp(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(trimmed) ? trimmed : "";
}

function safeLink(value, fallback = "#") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (/^#[\w-]+$/.test(trimmed)) return trimmed;
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) return trimmed;
  if (/^mailto:[^\s]+$/i.test(trimmed)) return trimmed;
  return fallback;
}

function safeImage(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) return trimmed;
  if (/^images\/[\w./-]+$/.test(trimmed) && !trimmed.includes("..")) return trimmed;
  return "";
}

function section(value, fallback, build) {
  return build(isObject(value) ? value : {}, fallback);
}  

function button(value, fallback) {
  const source = isObject(value) ? value : {};
  return {
    label: text(source.label, fallback.label),
    target: safeLink(source.target, fallback.target),
  };
}

function list(value, fallback, mapItem) {
  if (!Array.isArray(value)) return fallback.map((item, index) => mapItem(item, index));
  return value
    .map((item, index) => (isObject(item) ? mapItem(item, index) : null))
    .filter(Boolean);
}

function sanitize(raw) {
  const source = isObject(raw) ? raw : {};
  const fb = FALLBACK_CONTENT;

  return {
    site: section(source.site, fb.site, (s, f) => ({
      pageTitle: text(s.pageTitle, f.pageTitle),
      metaDescription: text(s.metaDescription, f.metaDescription),
      navName: text(s.navName, f.navName),
      navButton: button(s.navButton, f.navButton),
    })),
    hero: section(source.hero, fb.hero, (s, f) => ({
      heading: text(s.heading, f.heading),
      highlight: text(s.highlight, f.highlight),
      description: text(s.description, f.description),
      image: safeImage(s.image) || f.image,
      imageAlt: text(s.imageAlt, f.imageAlt),
      available: typeof s.available === "boolean" ? s.available : f.available,
      statusText: text(s.statusText, f.statusText),
      primaryButton: button(s.primaryButton, f.primaryButton),
      secondaryButton: button(s.secondaryButton, f.secondaryButton),
    })),
    profile: section(source.profile, fb.profile, (s, f) => ({
      name: text(s.name, f.name),
      image: safeImage(s.image) || f.image,
      imageAlt: text(s.imageAlt, f.imageAlt),
      aboutHeading: text(s.aboutHeading, f.aboutHeading),
      aboutDescription: text(s.aboutDescription, f.aboutDescription),
    })),
    contact: section(source.contact, fb.contact, (s, f) => ({
      tag: text(s.tag, f.tag),
      heading: text(s.heading, f.heading),
      highlight: text(s.highlight, f.highlight),
      text: text(s.text, f.text),
      email: /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(text(s.email))
        ? s.email.trim()
        : f.email,
      buttonLabel: text(s.buttonLabel, f.buttonLabel),
      bannerImage: safeImage(s.bannerImage) || f.bannerImage,
    })),
    socials: list(source.socials, fb.socials, (item, index) => ({
      id: text(item.id, `social-${index}`),
      platform: Object.hasOwn(SOCIAL_ICONS, item.platform) ? item.platform : "",
      url: safeHttp(item.url),
    })).filter((item) => item.platform),
    footer: section(source.footer, fb.footer, (s, f) => ({
      brandName: text(s.brandName, f.brandName),
      roles: Array.isArray(s.roles)
        ? s.roles.filter((role) => typeof role === "string" && role.trim())
        : f.roles,
      copyright: text(s.copyright, f.copyright),
    })),
    projectList: list(source.projectList, fb.projectList, (item, index) => ({
      id: text(item.id, `project-${index}`),
      name: text(item.name),
      imageSrc: safeImage(item.imageSrc),
      description: text(item.description),
      appType: text(item.appType),
      liveUrl: safeHttp(item.liveUrl),
      githubUrl: safeHttp(item.githubUrl),
    })).filter((item) => item.name),
    tools: list(source.tools, fb.tools, (item, index) => ({
      id: text(item.id, `tool-${index}`),
      name: text(item.name),
      logo: safeImage(item.logo),
    })).filter((item) => item.name),
    wds: list(source.wds, fb.wds, (item, index) => ({
      id: text(item.id, `service-${index}`),
      logo: safeImage(item.logo),
      title: text(item.title),
      description: text(item.description),
    })).filter((item) => item.title),
  };
}

function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(name, value === true ? "" : value);
  }
  const items = Array.isArray(children) ? children : [children];
  for (const child of items) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function svgIcon() {
  const template = document.createElement("template");
  template.innerHTML = ARROW_SVG;
  return template.content.firstElementChild;
}

function highlighted(textValue, highlight, className) {
  const index = highlight ? textValue.indexOf(highlight) : -1;
  if (index === -1) return [document.createTextNode(textValue)];
  return [
    document.createTextNode(textValue.slice(0, index)),
    el("span", { class: className }, highlight),
    document.createTextNode(textValue.slice(index + highlight.length)),
  ];
}

function multiline(value) {
  const nodes = [];
  value.split("\n").forEach((line, index) => {
    if (index > 0) nodes.push(document.createElement("br"));
    nodes.push(document.createTextNode(line));
  });
  return nodes;
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function setImage(selector, source, alt) {
  const node = document.querySelector(selector);
  if (!node) return;
  if (source) node.setAttribute("src", source);
  node.setAttribute("alt", alt);
}

function renderSite(site) {
  document.title = site.pageTitle;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute("content", site.metaDescription);
  setText(".main_nav .name", site.navName);
  talkBtn.dataset.target = site.navButton.target;
  talkBtn.replaceChildren(
    document.createTextNode(`${site.navButton.label} `),
    el("i", { class: "fa-solid fa-arrow-right talk_arrow" }),
  );
}

function renderHero(hero) {
  const status = document.querySelector(".status");
  status.textContent = hero.statusText;
  status.hidden = !hero.statusText;
  status.classList.toggle("is-unavailable", !hero.available);

  document
    .querySelector(".coloredH h1")
    .replaceChildren(...highlighted(hero.heading, hero.highlight, "coloredHeader"));
  setText(".hTxps", hero.description);

  const primary = document.querySelector(".explore_btn a");
  primary.setAttribute("href", hero.primaryButton.target);
  primary.replaceChildren(
    document.createTextNode(`${hero.primaryButton.label} `),
    el("i", { class: "explore_arrow fa-solid fa-arrow-right" }),
  );

  const secondary = document.querySelector(".gTouch_btn a");
  secondary.setAttribute("href", hero.secondaryButton.target);
  secondary.textContent = hero.secondaryButton.label;

  const workspace = document.querySelector(".workspace");
  workspace.hidden = !hero.image;
  setImage(".workspace img", hero.image, hero.imageAlt);
}

function renderProfile(profile) {
  document
    .querySelector(".abts h1")
    .replaceChildren(
      document.createTextNode(profile.aboutHeading ? `${profile.aboutHeading} ` : ""),
      el("span", {}, profile.name),
    );
  setText(".abt_description", profile.aboutDescription);
  setImage(".abt .image img", profile.image, profile.imageAlt);
}

function renderContact(contact, socials) {
  setText(".cTag", contact.tag);
  document
    .querySelector(".cHeader h2")
    .replaceChildren(...highlighted(contact.heading, contact.highlight, "hl"));
  document.querySelector(".cHeader p").replaceChildren(...multiline(contact.text));

  const emailButton = document.querySelector(".eBtn");
  emailButton.setAttribute("href", `mailto:${contact.email}`);
  emailButton.replaceChildren(
    el("i", { class: "fa-solid fa-envelope" }),
    document.createTextNode(` ${contact.buttonLabel} `),
    el("i", { class: "fa-solid fa-arrow-right" }),
  );

  setImage(".cImg img", contact.bannerImage, "Workspace");

  const socialBox = document.querySelector(".cSocials");
  socialBox.hidden = socials.length === 0;
  document.querySelector(".sIcons").replaceChildren(
    ...socials.map((social) =>
      el(
        "a",
        {
          href: social.url || "#",
          "aria-label": SOCIAL_LABELS[social.platform],
          "data-id": social.id,
          target: social.url ? "_blank" : false,
          rel: social.url ? "noopener noreferrer" : false,
        },
        el("i", { class: SOCIAL_ICONS[social.platform] }),
      ),
    ),
  );
}

function renderFooter(footer) {
  setText(".bName", footer.brandName);
  const roles = [];
  footer.roles.forEach((role, index) => {
    if (index > 0) roles.push(el("span", { class: "dSep" }, "\u2022"));
    roles.push(document.createTextNode(index > 0 ? ` ${role} ` : `${role} `));
  });
  document.querySelector(".bRoles").replaceChildren(...roles);
  setText(".fCopy p", footer.copyright);
}

function projectCard(project) {
  const actions = [];
  if (project.githubUrl) {
    actions.push(
      el(
        "a",
        {
          class: "icon_btm",
          href: project.githubUrl,
          target: "_blank",
          rel: "noopener noreferrer",
          "aria-label": `${project.name} source code`,
        },
        el("i", { class: "fa-brands fa-github" }),
      ),
    );
  }
  if (project.liveUrl) {
    const live = el("a", {
      class: "icon_btm",
      href: project.liveUrl,
      rel: "noopener",
      "aria-label": `Open ${project.name}`,
    });
    live.append(svgIcon());
    actions.push(live);
  }

  return el("div", { class: "pCard", "data-id": project.id }, [
    project.imageSrc
      ? el("img", { src: project.imageSrc, alt: project.name, loading: "lazy" })
      : null,
    el("h3", {}, project.name),
    el("p", {}, project.description),
    el("div", { class: "btm" }, [
      el("span", {}, project.appType),
      el("div", { class: "pActions" }, actions),
    ]),
  ]);
}

function toolCard(tool) {
  return el("div", { class: "toolCard", "data-id": tool.id }, [
    tool.logo ? el("img", { src: tool.logo, alt: tool.name }) : null,
    el("p", {}, tool.name),
  ]);
}

function serviceCard(service) {
  return el("div", { class: "wdsCard", "data-id": service.id }, [
    service.logo ? el("img", { src: service.logo, alt: service.title }) : null,
    el("div", { class: "wtxt" }, [
      el("h2", {}, service.title),
      el("p", {}, service.description),
    ]),
  ]);
}

function render(content) {
  renderSite(content.site);
  renderHero(content.hero);
  renderProfile(content.profile);
  renderContact(content.contact, content.socials);
  renderFooter(content.footer);
  document.querySelector(".myProjects").replaceChildren(...content.projectList.map(projectCard));
  document.querySelector(".tools").replaceChildren(...content.tools.map(toolCard));
  document.querySelector(".wdss").replaceChildren(...content.wds.map(serviceCard));
}

async function loadContent() {
  try {
    const response = await fetch(DATA_URL, {
      cache: "no-cache",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return sanitize(await response.json());
  } catch (error) {
    console.warn("Portfolio data could not be loaded. Showing built-in content.", error);
    return sanitize(FALLBACK_CONTENT);
  }
}

function toggleMenu() {
  const isOpen = mainNav.classList.toggle("open");
  menuBtn.setAttribute("aria-expanded", isOpen);
  menuBtn.querySelector("i").className = isOpen
    ? "fa-solid fa-xmark"
    : "fa-solid fa-bars";
}

function closeMenu() {
  mainNav.classList.remove("open");
  menuBtn.setAttribute("aria-expanded", false);
  menuBtn.querySelector("i").className = "fa-solid fa-bars";
}

function goToTarget() {
  const target = talkBtn.dataset.target || "#contact";
  closeMenu();
  if (target.startsWith("#")) {
    const node = document.getElementById(target.slice(1));
    if (node) node.scrollIntoView();
    return;
  }
  window.location.href = target;
}

function markActiveLink() {
  const sections = document.querySelectorAll("[data-section]");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          link.classList.toggle(
            "active",
            link.getAttribute("href") === `#${entry.target.id}`,
          );
        });
      });
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  sections.forEach((item) => observer.observe(item));
}

function initPreviewBridge() {
  const inFrame = window.parent !== window;
  const requested = /(^|[?&])cms-preview=1(&|$)/.test(window.location.search);
  if (!inFrame || !requested) return;

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (link && !(link.getAttribute("href") || "").startsWith("#")) event.preventDefault();
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const message = event.data;
    if (!isObject(message) || message.channel !== PREVIEW_CHANNEL || message.version !== 1) return;

    if (message.type === "content" && isObject(message.payload)) {
      render(sanitize(message.payload));
    } else if (message.type === "focus" && FOCUS_TARGETS.includes(message.target)) {
      const node = document.getElementById(message.target);
      if (node) node.scrollIntoView();
    }
  });

  window.parent.postMessage(
    { channel: PREVIEW_CHANNEL, version: 1, type: "ready" },
    window.location.origin,
  );
}

async function init() {
  menuBtn.addEventListener("click", toggleMenu);
  talkBtn.addEventListener("click", goToTarget);
  navLinks.forEach((link) => link.addEventListener("click", closeMenu));

  render(await loadContent());
  markActiveLink();
  initPreviewBridge();
}

init();
