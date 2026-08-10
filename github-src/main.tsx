import React from "react";
import ReactDOM from "react-dom/client";
import LoanApp from "../components/LoanApp";
import "../app/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LoanApp />
  </React.StrictMode>,
);
