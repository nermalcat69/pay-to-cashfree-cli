package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
	qrterminal "github.com/mdp/qrterminal/v3"
)

// ── backend URL (override with STORE_API env var) ─────────────────────────────

const defaultAPIURL = "http://localhost:3005"

func apiURL() string {
	if u := os.Getenv("STORE_API"); u != "" {
		return strings.TrimRight(u, "/")
	}
	return defaultAPIURL
}

// ── styles ────────────────────────────────────────────────────────────────────

var (
	titleStyle   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#16A34A")).BorderStyle(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("#16A34A")).Padding(0, 2)
	successStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#10B981"))
	errorStyle   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#EF4444"))
	infoStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))
	priceStyle   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#F59E0B"))
	labelStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("#9CA3AF"))
	tagStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("#6366F1"))
)

// ── API types (mirror backend) ────────────────────────────────────────────────

type Variant struct {
	Label    string `json:"label"`
	Price    string `json:"price"`
	PriceINR int    `json:"price_inr"`
	Unit     string `json:"unit"`
}

type Product struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Category    string    `json:"category"`
	Variants    []Variant `json:"variants"`
}

type CreateOrderReq struct {
	ProductID    int    `json:"product_id"`
	VariantIndex int    `json:"variant_index"`
	Name         string `json:"name"`
	Phone        string `json:"phone"`
	Email        string `json:"email"`
}

type CreateOrderResp struct {
	OrderID    string  `json:"order_id"`
	PaymentURL string  `json:"payment_url"`
	Amount     float64 `json:"amount"`
	IsDemo     bool    `json:"is_demo"`
}

type OrderStatusResp struct {
	OrderID    string  `json:"order_id"`
	Status     string  `json:"status"`
	Amount     float64 `json:"amount"`
	AmountPaid float64 `json:"amount_paid"`
}

// ── backend client ────────────────────────────────────────────────────────────

type client struct{ base string }

func (c *client) getProducts() ([]Product, error) {
	resp, err := http.Get(c.base + "/products")
	if err != nil {
		return nil, fmt.Errorf("cannot reach store backend at %s — is it running?", c.base)
	}
	defer resp.Body.Close()
	var out []Product
	return out, json.NewDecoder(resp.Body).Decode(&out)
}

func (c *client) createOrder(req CreateOrderReq) (*CreateOrderResp, error) {
	resp, err := postJSON(c.base+"/orders", req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&e)
		return nil, fmt.Errorf("backend error: %s", e.Error)
	}
	var out CreateOrderResp
	return &out, json.NewDecoder(resp.Body).Decode(&out)
}

// streamStatus opens an SSE connection to /orders/:id/stream and calls onEvent
// for every status update. Returns when the stream closes or onEvent returns true.
func (c *client) streamStatus(orderID string, onEvent func(OrderStatusResp) bool) error {
	req, err := http.NewRequest(http.MethodGet, c.base+"/orders/"+orderID+"/stream", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")

	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return fmt.Errorf("cannot connect to payment stream: %w", err)
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var status OrderStatusResp
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &status); err != nil {
			continue
		}
		if onEvent(status) {
			return nil
		}
	}
	return scanner.Err()
}

func postJSON(url string, body any) (*http.Response, error) {
	pr, pw := io.Pipe()
	go func() {
		_ = json.NewEncoder(pw).Encode(body)
		pw.Close()
	}()
	req, err := http.NewRequest(http.MethodPost, url, pr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return http.DefaultClient.Do(req)
}

// ── rate limiting ─────────────────────────────────────────────────────────────

const rateLimitSeconds = 30

func rateLimitFile() string {
	return filepath.Join(os.TempDir(), ".store_last_order")
}

func checkRateLimit() error {
	data, err := os.ReadFile(rateLimitFile())
	if err != nil {
		return nil
	}
	var lastTS int64
	if _, err := fmt.Sscanf(string(data), "%d", &lastTS); err != nil {
		return nil
	}
	if elapsed := time.Now().Unix() - lastTS; elapsed < rateLimitSeconds {
		return fmt.Errorf("please wait %d seconds before placing another order", rateLimitSeconds-elapsed)
	}
	return nil
}

func markOrderCreated() {
	_ = os.WriteFile(rateLimitFile(), []byte(strconv.FormatInt(time.Now().Unix(), 10)), 0600)
}

// ── helpers ───────────────────────────────────────────────────────────────────

func renderQR(url string) {
	fmt.Println()
	fmt.Println(labelStyle.Render("  ┌─ Payment QR ──────────────────────────────────────────┐"))
	fmt.Println()
	qrterminal.GenerateWithConfig(url, qrterminal.Config{
		Level:          qrterminal.M,
		Writer:         os.Stdout,
		HalfBlocks:     true,
		BlackChar:      qrterminal.BLACK_BLACK,
		BlackWhiteChar: qrterminal.BLACK_WHITE,
		WhiteBlackChar: qrterminal.WHITE_BLACK,
		WhiteChar:      qrterminal.WHITE_WHITE,
		QuietZone:      2,
	})
	fmt.Println(labelStyle.Render("  └───────────────────────────────────────────────────────┘"))
	fmt.Println()
}

func printOrderSummary(order *CreateOrderResp, p Product, v Variant, name, phone, email string) {
	fmt.Println(labelStyle.Render("  Order ID  : ") + order.OrderID)
	fmt.Println(labelStyle.Render("  Product   : ") + p.Name + " — " + v.Label + " (" + v.Unit + ")")
	fmt.Println(labelStyle.Render("  Amount    : ") + priceStyle.Render(v.Price))
	fmt.Println(labelStyle.Render("  Customer  : ") + name + " · " + phone + " · " + email)
	fmt.Println(labelStyle.Render("  Pay URL   : ") + order.PaymentURL)
	if order.IsDemo {
		fmt.Println(infoStyle.Render("  (Demo mode — no real transaction)"))
	}
	fmt.Println()
}

func productOptions(ps []Product) []huh.Option[int] {
	opts := make([]huh.Option[int], len(ps))
	for i, p := range ps {
		label := fmt.Sprintf("%-18s  %s  %s", p.Name, tagStyle.Render("["+p.Category+"]"), p.Description)
		opts[i] = huh.NewOption(label, p.ID)
	}
	return opts
}

func variantOptions(p Product) []huh.Option[int] {
	opts := make([]huh.Option[int], len(p.Variants))
	for i, v := range p.Variants {
		label := fmt.Sprintf("%-12s  %s  (%s)", v.Label, priceStyle.Render(v.Price), v.Unit)
		opts[i] = huh.NewOption(label, i)
	}
	return opts
}

func findProduct(ps []Product, id int) (Product, bool) {
	for _, p := range ps {
		if p.ID == id {
			return p, true
		}
	}
	return Product{}, false
}

// ── main ──────────────────────────────────────────────────────────────────────

func main() {
	c := &client{base: apiURL()}

	fmt.Println()
	fmt.Println(titleStyle.Render(" Fresh Market — Terminal Store "))
	fmt.Println()
	fmt.Println(infoStyle.Render("  Connecting to " + c.base + "…"))

	products, err := c.getProducts()
	if err != nil {
		fmt.Println(errorStyle.Render("  " + err.Error()))
		os.Exit(1)
	}
	fmt.Println(successStyle.Render(fmt.Sprintf("  Connected. %d products available.", len(products))))
	fmt.Println()

	// Step 1: choose product
	var productID int
	if err := huh.NewForm(huh.NewGroup(
		huh.NewSelect[int]().
			Title("Select a product").
			Options(productOptions(products)...).
			Value(&productID),
	)).Run(); err != nil {
		fmt.Println(infoStyle.Render("  Cancelled.")); os.Exit(0)
	}

	product, _ := findProduct(products, productID)
	fmt.Println()
	fmt.Println(infoStyle.Render("  " + product.Description))
	fmt.Println()

	// Step 2: choose variant
	var variantIdx int
	if err := huh.NewForm(huh.NewGroup(
		huh.NewSelect[int]().
			Title("Select quantity / size").
			Options(variantOptions(product)...).
			Value(&variantIdx),
	)).Run(); err != nil {
		fmt.Println(infoStyle.Render("  Cancelled.")); os.Exit(0)
	}
	variant := product.Variants[variantIdx]

	// Step 3: customer details
	var name, phone, email string
	if err := huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title("Your full name").
			Placeholder("Ravi Kumar").
			Value(&name).
			Validate(func(s string) error {
				if len(s) < 2 {
					return fmt.Errorf("name must be at least 2 characters")
				}
				return nil
			}),
		huh.NewInput().
			Title("Phone number (10-digit)").
			Placeholder("9999999999").
			Value(&phone).
			Validate(func(s string) error {
				if len(s) != 10 {
					return fmt.Errorf("must be exactly 10 digits")
				}
				for _, ch := range s {
					if ch < '0' || ch > '9' {
						return fmt.Errorf("digits only")
					}
				}
				return nil
			}),
		huh.NewInput().
			Title("Email address").
			Placeholder("ravi@example.com").
			Value(&email).
			Validate(func(s string) error {
				if !strings.Contains(s, "@") || len(s) < 5 {
					return fmt.Errorf("enter a valid email")
				}
				return nil
			}),
	)).Run(); err != nil {
		fmt.Println(infoStyle.Render("  Cancelled.")); os.Exit(0)
	}

	// Step 4: confirm
	var confirm bool
	if err := huh.NewForm(huh.NewGroup(
		huh.NewConfirm().
			Title("Confirm order?").
			Description(fmt.Sprintf(
				"%s — %s\n%s  (%s)\nTotal: %s",
				product.Name, product.Category,
				variant.Label, variant.Unit,
				variant.Price,
			)).
			Affirmative("Pay now").
			Negative("Cancel").
			Value(&confirm),
	)).Run(); err != nil || !confirm {
		fmt.Println(infoStyle.Render("  Order cancelled.")); os.Exit(0)
	}

	// Step 5: rate limit check
	if err := checkRateLimit(); err != nil {
		fmt.Println(errorStyle.Render("  " + err.Error())); os.Exit(1)
	}

	// Step 6: create order via backend
	fmt.Println()
	fmt.Println(infoStyle.Render("  Creating payment link…"))

	order, err := c.createOrder(CreateOrderReq{
		ProductID:    product.ID,
		VariantIndex: variantIdx,
		Name:         name,
		Phone:        "+91" + phone,
		Email:        email,
	})
	if err != nil {
		fmt.Println(errorStyle.Render("  " + err.Error())); os.Exit(1)
	}

	markOrderCreated()

	if order.IsDemo {
		fmt.Println(successStyle.Render("  [DEMO] Order created!"))
	} else {
		fmt.Println(successStyle.Render("  Order created!"))
	}
	fmt.Println()
	printOrderSummary(order, product, variant, name, phone, email)
	renderQR(order.PaymentURL)

	if order.IsDemo {
		fmt.Println(infoStyle.Render("  Scan the QR to simulate. No real transaction will occur."))
		fmt.Println()
		return
	}

	// Step 7: stream payment status (backend polls Cashfree every 2s)
	fmt.Println(infoStyle.Render("  Waiting for payment… (Ctrl+C to exit)"))
	fmt.Println()

	const linkExpiry = 5 * time.Minute
	expiresAt := time.Now().Add(linkExpiry)

	var (
		mu          sync.Mutex
		stopOnce    sync.Once
		timerDone   = make(chan struct{})
	)
	stopTimer := func() { stopOnce.Do(func() { close(timerDone) }) }

	// Countdown goroutine — updates the current line in place every 500ms.
	go func() {
		for {
			select {
			case <-timerDone:
				mu.Lock()
				fmt.Print("\r" + strings.Repeat(" ", 52) + "\r")
				mu.Unlock()
				return
			default:
				remaining := time.Until(expiresAt)
				if remaining <= 0 {
					mu.Lock()
					fmt.Print("\r" + strings.Repeat(" ", 52) + "\r")
					fmt.Println(errorStyle.Render("  Payment link expired."))
					mu.Unlock()
					stopTimer()
					return
				}
				mins := int(remaining.Minutes())
				secs := int(remaining.Seconds()) % 60
				mu.Lock()
				fmt.Printf("\r  %s  %dm %02ds   ",
					labelStyle.Render("Link expires in"), mins, secs)
				mu.Unlock()
				time.Sleep(500 * time.Millisecond)
			}
		}
	}()

	lastStatus := ""
	err = c.streamStatus(order.OrderID, func(s OrderStatusResp) bool {
		switch s.Status {
		case "PAID":
			stopTimer()
			mu.Lock()
			fmt.Print("\r" + strings.Repeat(" ", 52) + "\r")
			fmt.Println(successStyle.Render("  Payment received! Order confirmed."))
			fmt.Println(labelStyle.Render(fmt.Sprintf("  Amount paid: ₹%.0f", s.AmountPaid)))
			fmt.Println()
			mu.Unlock()
			return true
		case "EXPIRED", "CANCELLED":
			stopTimer()
			mu.Lock()
			fmt.Print("\r" + strings.Repeat(" ", 52) + "\r")
			fmt.Println(errorStyle.Render("  Payment " + strings.ToLower(s.Status) + ". Please try again."))
			mu.Unlock()
			return true
		default:
			// Only print when status actually changes (no ACTIVE spam).
			if s.Status != lastStatus && s.Status != "ACTIVE" {
				mu.Lock()
				fmt.Print("\r" + strings.Repeat(" ", 52) + "\r\n")
				fmt.Println(infoStyle.Render("  Status: " + s.Status))
				mu.Unlock()
			}
			lastStatus = s.Status
			return false
		}
	})

	stopTimer()
	if err != nil {
		fmt.Println(errorStyle.Render("  Stream error: " + err.Error()))
	}
}
