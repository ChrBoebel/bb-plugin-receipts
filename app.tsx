import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ReceiptsPage } from "@/components/usage/receipts-page";
import "./app.css";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "usage",
    title: "Usage",
    icon: "ChartColumn",
    path: "usage",
    component: ReceiptsPage,
  });
});
