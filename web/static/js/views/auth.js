import { el } from "../api.js?v=25";
import { login, register } from "../auth.js?v=25";

function field(labelText, input) {
  const label = el("label", "filter-field auth-field");
  label.append(el("span", "filter-label", labelText), input);
  return label;
}

function authForm(mode) {
  const wrap = el("div", "auth-card");
  const isRegister = mode === "register";
  wrap.append(el("h1", "page-title", isRegister ? "注册" : "登录"));

  const username = document.createElement("input");
  username.type = "text";
  username.required = true;
  username.autocomplete = "username";
  username.placeholder = "3-32 位字母、数字、_ 或 -";
  username.setAttribute("aria-label", "用户名");

  const password = document.createElement("input");
  password.type = "password";
  password.required = true;
  password.autocomplete = isRegister ? "new-password" : "current-password";
  password.placeholder = isRegister ? "至少 8 位" : "密码";
  password.setAttribute("aria-label", "密码");

  const errorLine = el("p", "code-error", "");
  errorLine.hidden = true;

  const submit = el("button", "btn btn-run auth-submit", isRegister ? "注册并登录" : "登录");
  submit.type = "submit";

  const form = el("form", "auth-form");
  form.append(field("用户名", username), field("密码", password), errorLine, submit);
  wrap.append(form);

  if (isRegister) {
    wrap.append(el("p", "muted", "新注册的账号为普通用户；“高级用户”角色仅由内置测试账号提供。"));
  } else {
    const details = el("details", "auth-test-accounts");
    details.append(el("summary", null, "内置测试账号（密码见 README）"));
    const list = el("ul", "auth-account-list");
    [
      ["guest / guest123456", "游客"],
      ["user / user123456", "普通用户"],
      ["premium / premium123456", "高级用户"],
    ].forEach(([account, role]) => {
      list.append(el("li", null, [el("code", null, account), ` — ${role}`]));
    });
    details.append(list);
    wrap.append(details);
  }

  const swap = el("a", "auth-swap", isRegister ? "已有账号？去登录" : "没有账号？去注册");
  swap.href = isRegister ? "#/login" : "#/register";
  wrap.append(swap);
  wrap.append(el("p", "muted demo-note",
    "账号只保存在本机 users 数据库，不联网、不上传；角色只影响界面与附加功能入口，所有题目对任何角色都可完整阅读。"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorLine.hidden = true;
    submit.disabled = true;
    submit.textContent = "提交中…";
    try {
      if (isRegister) {
        await register(username.value.trim(), password.value);
      } else {
        await login(username.value.trim(), password.value);
      }
      location.hash = "#/problems";
    } catch (err) {
      errorLine.textContent = err.message;
      errorLine.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = isRegister ? "注册并登录" : "登录";
    }
  });
  return wrap;
}

export async function renderLogin() {
  const app = document.getElementById("app");
  document.title = "登录 · LeetCode 题库";
  app.replaceChildren(authForm("login"));
}

export async function renderRegister() {
  const app = document.getElementById("app");
  document.title = "注册 · LeetCode 题库";
  app.replaceChildren(authForm("register"));
}
