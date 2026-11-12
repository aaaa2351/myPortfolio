const myProjects = document.querySelector(".myProjects");
const mainNav = document.querySelector(".main_nav");
const menuBtn = document.querySelector(".menu_btn");
const talkBtn = document.querySelector(".talk_btn");
const navLinks = document.querySelectorAll(".links a");

const projectList = [
  {
    name: "Cipher",
    imageSrc: "images/cipher.png",
    description: "A premium platform built for learning and growth",
    appType: "Web App",
    liveUrl: "https://cipherquiz.vercel.app",
  },
  {
    name: "The fish spot",
    imageSrc: "images/fishSpot.jpg",
    description: "A modern restaurant website for The Fish Spot.",
    appType: "Website",
    liveUrl: "https://cipherquiz.vercel.app",
  },
  {
    name: "Task Manager",
    imageSrc:
      "https://images.unsplash.com/photo-1540350394557-8d14678e7f91?auto=format&fit=crop&w=600&q=80",
    description:
      "A productivity tool designed to track and organize daily workflows.",
    appType: "Web App",
    liveUrl: "https://cipherquiz.vercel.app",
  },
];

const tools = [
  {
    name: "HTML5",
    logo: "images/html.jpg",
  },
  {
    name: "CSS3",
    logo: "images/css.jpg",
  },
  {
    name: "Git",
    logo: "images/git.svg",
  },
  {
    name: "JavaScript",
    logo: "images/js.jpg",
  },
  {
    name: "Blender",
    logo: "images/blender.jpg",
  },
];

const wds = [
  {
    logo: "images/wds/web.svg",
    title: "Web Development",
    description: "Modern, responsive and scalable web applications.",
  },
  {
    logo: "images/wds/js.svg",
    title: "Interactive JavaScript",
    description:
      "Adding dynamic behavior, custom logic, and interactive features to websites using vanilla JavaScript.",
  },
  {
    logo: "images/wds/3d.svg",
    title: "3D Modeling & Assets",
    description:
      "Crafting custom 3D models, low-poly assets, and visual elements for digital projects using Blender.",
  },
  {
    logo: "images/wds/design.svg",
    title: "UI/UX Development",
    description: "Beautiful, intuitive and user-centered designs.",
  },
];

function createProjects() {
  projectList.forEach((project) => {
    let projectCard = document.createElement("div");
    projectCard.classList.add("pCard");
    projectCard.innerHTML = `
            <img src="${project.imageSrc}" alt="${project.name}">
            <h3>${project.name}</h3>
            <p>${project.description}</p>
            <div class="btm">
              <span>${project.appType}</span>
              <div class="icon_btm">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14"></path>
                  <path d="m12 5 7 7-7 7"></path>
                </svg>
              </div>
            </div>
    `;
    let icon_btm = projectCard.querySelector('.icon_btm')
icon_btm.addEventListener("click", () => {
            window.location.href = project.liveUrl; 
        });
    myProjects.appendChild(projectCard);
  });
}

function createTool() {
  let mainTool = document.querySelector(".tools");
  tools.forEach((tool) => {
    const toolCard = document.createElement("div");
    toolCard.classList.add("toolCard");
    toolCard.innerHTML = `
            <img src="${tool.logo}" alt="${tool.name}" >
            <p>${tool.name}</p>
    `;
    mainTool.appendChild(toolCard);
  });
}

function createWds() {
  let mainWds = document.querySelector(".wdss");
  wds.forEach((item) => {
    const wdsCard = document.createElement("div");
    wdsCard.classList.add("wdsCard");
    wdsCard.innerHTML = `
            <img src="${item.logo}" alt="${item.title}" >
            <div class="wtxt">
              <h2>${item.title}</h2>
              <p>${item.description}</p>
            </div>
    `;
    mainWds.appendChild(wdsCard);
  });
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

function goToContact() {
  document.querySelector("#contact").scrollIntoView();
  closeMenu();
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
  sections.forEach((section) => observer.observe(section));
}

menuBtn.addEventListener("click", toggleMenu);
talkBtn.addEventListener("click", goToContact);
navLinks.forEach((link) => link.addEventListener("click", closeMenu));

createWds();
createTool();
createProjects();
markActiveLink();
