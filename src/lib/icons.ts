export const iconMap: Record<string, string> = {
  "argo-cd": "/icons/argo.svg",
  circleci: "/icons/circleci.svg",
  github: "/icons/github.svg",
  gitlab: "/icons/gitlab.svg",
  docker: "/icons/docker.svg",
  aws: "/icons/aws.svg",
  azure: "/icons/azure.svg",
  firebase: "/icons/firebase.svg",
  gcp: "/icons/google_cloud.svg",
  kubernetes: "/icons/kubernetes.svg",
  terraform: "/icons/terraform.svg",
  nextjs: "/icons/nextjs.svg",
  nuxt: "/icons/nuxtjs.svg",
  rails: "/icons/rails.svg",
  react: "/icons/reactjs.svg",
  vue: "/icons/vuejs.svg",
  go: "/icons/golang.svg",
  nodejs: "/icons/nodejs.svg",
  python: "/icons/python.svg",
  ruby: "/icons/ruby.svg",
  rust: "/icons/rust.svg",
  typescript: "/icons/typescript.svg",
};

export function iconPath(slug?: string) {
  if (!slug) return null;
  return iconMap[slug] || null;
}

